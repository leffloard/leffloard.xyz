"use server";

import { ObjectId, type Db } from "mongodb";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { INQUIRY_STATUSES, STATUS_LABELS } from "@/lib/intake/options";
import { LABEL_PATTERN, MAX_LABELS } from "@/lib/intake/labels";
import { cleanText } from "@/lib/intake/text";
import { DATE_PATTERN, isCalendarDate, TIME_PATTERN, zonedInstant } from "@/lib/intake/time";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { snoozeUntil } from "@/lib/snooze";
import { adminAction, type ActionContext } from "@/server/auth/action";
import { audit } from "@/server/auth/audit";
import { touchClient } from "@/server/clients/store";
import { now } from "@/server/clock";
import { getEnv } from "@/server/env";
import { block } from "@/server/inquiries/blocklist";
import {
  addReply,
  changeStatus,
  deleteInquiry,
  getInquiry,
  setLabels,
  setNote,
  setSchedule,
  snooze,
} from "@/server/inquiries/store";
import type { InquiryDoc, ReplyEntry } from "@/server/inquiries/types";
import { readChannels } from "@/server/notify/channels";
import { sendQueuedSoon } from "@/server/notify/kick";
import { enqueue, outbox } from "@/server/notify/outbox";
import { replyEmail, statusEmail, type EmailMessage, type VisitorStatus } from "@/server/notify/templates";

const inquiryId = z.string().regex(/^[a-f0-9]{24}$/, "Unknown message.");
const NOT_FOUND = "This message no longer exists.";
const NO_EMAIL = "Email is not set up on the server (SMTP_* settings), so nothing can be sent yet.";

function invalidField(field: string, message: string): ActionResult<never> {
  return {
    ok: false,
    error: "Check the highlighted fields.",
    code: "invalid",
    fieldErrors: { [field]: message },
  };
}

async function queueVisitorEmail(
  db: Db,
  inquiry: InquiryDoc,
  kind: ReplyEntry["kind"],
  message: EmailMessage,
  body: string,
): Promise<void> {
  const reply: ReplyEntry = {
    id: new ObjectId().toHexString(),
    kind,
    to: inquiry.email,
    subject: message.subject,
    body,
    createdAt: now(),
    delivery: "queued",
    sentAt: null,
    error: null,
  };
  await addReply(db, inquiry._id, reply);
  // An email to a client counts as contact with them.
  if (inquiry.clientId) await touchClient(db, inquiry.clientId, reply.createdAt, reply.createdAt);
  await enqueue(db, {
    channel: "email",
    payload: message,
    dedupeKey: `reply:${reply.id}`,
    label: `${kind === "reply" ? "Reply" : "Status email"} for ${inquiry.ref}`,
    ref: { inquiryId: inquiry._id, replyId: reply.id },
  });
  sendQueuedSoon();
}

function visitorEmailOptions() {
  const channels = readChannels();
  return { channels, options: { ownerEmail: channels.ownerEmail, siteUrl: getEnv().SITE_URL } };
}

// --- Status ----------------------------------------------------------------------------------------------

export const changeStatusAction = adminAction(
  z.object({
    id: inquiryId,
    status: z.enum(INQUIRY_STATUSES),
    notify: z.boolean().default(false),
    message: z.string().max(20_000).default(""),
  }),
  async (input, { db }) => {
    const note = cleanText(input.message, { maxLength: 2000, multiline: true });
    if (!note.ok) return invalidField("message", note.message);
    const notify = input.notify && input.status !== "spam";
    const { channels, options } = visitorEmailOptions();
    if (notify && !channels.email) return fail(NO_EMAIL);

    const updated = await changeStatus(db, new ObjectId(input.id), input.status);
    if (!updated) return fail(NOT_FOUND);
    if (notify) {
      const status = input.status as VisitorStatus;
      await queueVisitorEmail(
        db,
        updated,
        "status",
        statusEmail(updated, status, note.value, options),
        note.value ?? "",
      );
    }
    refresh();
    const label = STATUS_LABELS[input.status].toLowerCase();
    return ok(null, notify ? `Marked as ${label}. The email is on its way.` : `Marked as ${label}.`);
  },
);

export const markSpamAction = adminAction(
  z.object({ id: inquiryId, block: z.enum(["none", "email", "domain"]).default("none") }),
  async (input, { db, user, client }) => {
    const updated = await changeStatus(db, new ObjectId(input.id), "spam");
    if (!updated) return fail(NOT_FOUND);
    if (input.block !== "none") {
      const blocked = await block(db, input.block, updated.email);
      await audit(db, {
        action: "inbox.sender.blocked",
        actorId: user._id,
        ip: client.ip,
        userAgent: client.userAgent,
        details: { kind: blocked.kind, ref: updated.ref },
      });
    }
    refresh();
    if (input.block === "none") return ok(null, "Moved to spam. Spam is deleted after 30 days.");
    return ok(
      null,
      `Moved to spam. Future messages from this ${input.block === "email" ? "address" : "domain"} go to spam too.`,
    );
  },
);

// --- Reply -----------------------------------------------------------------------------------------------

export const replyAction = adminAction(
  z.object({
    id: inquiryId,
    subject: z.string().max(2000),
    body: z.string().max(50_000),
    then: z.enum(["open", "done", "keep"]).default("open"),
  }),
  async (input, { db }) => {
    const { channels, options } = visitorEmailOptions();
    if (!channels.email) return fail(NO_EMAIL);
    const subject = cleanText(input.subject, {
      maxLength: 200,
      required: true,
      requiredMessage: "Add a subject.",
    });
    if (!subject.ok) return invalidField("subject", subject.message);
    const body = cleanText(input.body, {
      maxLength: 10_000,
      required: true,
      multiline: true,
      requiredMessage: "Write the reply first.",
    });
    if (!body.ok) return invalidField("body", body.message);

    const inquiry = await getInquiry(db, new ObjectId(input.id));
    if (!inquiry) return fail(NOT_FOUND);
    if (inquiry.status === "spam")
      return fail("This message is in spam. Move it back to the inbox before replying.");
    await queueVisitorEmail(
      db,
      inquiry,
      "reply",
      replyEmail(inquiry, { subject: subject.value!, body: body.value! }, options),
      body.value!,
    );
    if (input.then === "done") await changeStatus(db, inquiry._id, "done");
    else if (input.then === "open" && inquiry.status === "new") await changeStatus(db, inquiry._id, "open");
    refresh();
    return ok(null, "Reply queued. It usually leaves within a few seconds.");
  },
);

// --- Details ---------------------------------------------------------------------------------------------

export const saveNoteAction = adminAction(
  z.object({ id: inquiryId, note: z.string().max(50_000) }),
  async (input, { db }) => {
    const note = cleanText(input.note, { maxLength: 2000, multiline: true });
    if (!note.ok) return invalidField("note", note.message);
    if (!(await setNote(db, new ObjectId(input.id), note.value ?? ""))) return fail(NOT_FOUND);
    refresh();
    return ok(null, "Note saved.");
  },
);

export const saveLabelsAction = adminAction(
  z.object({ id: inquiryId, labels: z.array(z.string().max(200)).max(50) }),
  async (input, { db }) => {
    const labels = [...new Set(input.labels.map((label) => label.trim().toLowerCase()).filter(Boolean))];
    const bad = labels.find((label) => !LABEL_PATTERN.test(label));
    if (bad !== undefined) {
      return invalidField(
        "labels",
        "Labels use letters, digits, spaces, dots and dashes, up to 24 characters.",
      );
    }
    if (labels.length > MAX_LABELS) return invalidField("labels", `Use at most ${MAX_LABELS} labels.`);
    if (!(await setLabels(db, new ObjectId(input.id), labels))) return fail(NOT_FOUND);
    refresh();
    return ok(null, "Labels saved.");
  },
);

export const snoozeAction = adminAction(
  z.object({ id: inquiryId, until: z.enum(["tomorrow", "3-days", "next-week", "wake"]) }),
  async (input, { db }) => {
    const until = input.until === "wake" ? null : snoozeUntil(input.until, now());
    if (!(await snooze(db, new ObjectId(input.id), until))) return fail(NOT_FOUND);
    refresh();
    return ok(
      null,
      until ? "Snoozed. It comes back to the inbox at 09:00 on that day." : "Back in the inbox.",
    );
  },
);

// Sets (or clears) the time of a requested call, in the visitor's time zone; optionally confirms it and
// emails the visitor the time.
export const scheduleCallAction = adminAction(
  z.object({
    id: inquiryId,
    date: z.string().max(32).default(""),
    time: z.string().max(32).default(""),
    clear: z.boolean().default(false),
    confirm: z.boolean().default(false),
    notify: z.boolean().default(false),
    message: z.string().max(20_000).default(""),
  }),
  async (input, { db }) => {
    const id = new ObjectId(input.id);
    const inquiry = await getInquiry(db, id);
    if (!inquiry) return fail(NOT_FOUND);
    if (inquiry.kind !== "call") return fail("Only call requests can be scheduled.");
    if (input.clear) {
      await setSchedule(db, id, null);
      refresh();
      return ok(null, "The call time was cleared.");
    }
    if (!DATE_PATTERN.test(input.date) || !isCalendarDate(input.date))
      return invalidField("date", "Choose a valid date.");
    if (!TIME_PATTERN.test(input.time)) return invalidField("time", "Use the 24-hour HH:MM format.");
    const note = cleanText(input.message, { maxLength: 2000, multiline: true });
    if (!note.ok) return invalidField("message", note.message);
    const zone = inquiry.call?.timeZone ?? ADMIN_TIME_ZONE;
    const at = zonedInstant(input.date, input.time, zone);
    if (!at) return invalidField("time", "That time does not exist in the visitor's time zone.");
    const { channels, options } = visitorEmailOptions();
    if (input.notify && !channels.email) return fail(NO_EMAIL);

    let updated = await setSchedule(db, id, at);
    if (updated && input.confirm) updated = await changeStatus(db, id, "confirmed");
    if (!updated) return fail(NOT_FOUND);
    if (input.notify) {
      await queueVisitorEmail(
        db,
        updated,
        "status",
        statusEmail(updated, "confirmed", note.value, options),
        note.value ?? "",
      );
    }
    refresh();
    return ok(
      null,
      input.notify ? "Call confirmed. The visitor gets the time by email." : "Call time saved.",
    );
  },
);

// --- Delete ----------------------------------------------------------------------------------------------

async function removeInquiry(context: ActionContext, id: ObjectId): Promise<InquiryDoc | null> {
  const inquiry = await getInquiry(context.db, id);
  if (!inquiry) return null;
  await deleteInquiry(context.db, id);
  // Queued and sent notifications carry the same personal data.
  await outbox(context.db).deleteMany({ "ref.inquiryId": id });
  await audit(context.db, {
    action: "inbox.inquiry.deleted",
    actorId: context.user._id,
    ip: context.client.ip,
    userAgent: context.client.userAgent,
    details: { ref: inquiry.ref },
  });
  return inquiry;
}

export const deleteInquiryAction = adminAction(z.object({ id: inquiryId }), async (input, context) => {
  if (!(await removeInquiry(context, new ObjectId(input.id)))) return fail(NOT_FOUND);
  redirect("/admin/inbox");
});
