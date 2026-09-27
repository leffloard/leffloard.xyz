"use server";

import { ObjectId } from "mongodb";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fail, ok } from "@/lib/action-result";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import {
  dateSchema,
  emailSchema,
  fieldError,
  idSchema,
  notesText,
  optionalIdSchema,
  requiredText,
  tagsSchema,
  text,
  timeSchema,
  timeZoneSchema,
  urlSchema,
  versionSchema,
} from "@/lib/forms";
import { todayIn, zonedInstant } from "@/lib/intake/time";
import { CURRENCIES } from "@/lib/money";
import { ACTIVITY_KINDS, CLIENT_STATUS_LABELS, CLIENT_STATUSES } from "@/lib/work/options";
import { adminAction } from "@/server/auth/action";
import { audit } from "@/server/auth/audit";
import {
  addActivity,
  createClient,
  createClientFromInquiry,
  deleteActivity,
  deleteClient,
  exportClient,
  getClient,
  linkInquiry,
  setClientStatus,
  unlinkInquiry,
  updateClient,
} from "@/server/clients/store";
import { now } from "@/server/clock";
import { notifyContext } from "@/server/calendar/public";
import { getInquiry } from "@/server/inquiries/store";
import { sendQueuedSoon } from "@/server/notify/kick";
import { endClientSessions, setPortalAccess } from "@/server/portal/access";
import { resolvePrivacyRequest } from "@/server/portal/privacy";
import { inviteToPortal } from "@/server/portal/service";

const NOT_FOUND = "This client no longer exists.";
const CONFLICT = "This client was changed somewhere else since you opened the form. Reload to see it.";

const clientFields = z.object({
  name: requiredText(120, "Add the client's name."),
  company: text({ maxLength: 120 }),
  email: emailSchema,
  phone: text({ maxLength: 40 }),
  website: urlSchema,
  location: text({ maxLength: 120 }),
  timeZone: timeZoneSchema,
  currency: z.enum(CURRENCIES),
  status: z.enum(CLIENT_STATUSES),
  tags: tagsSchema,
  notes: notesText(5000),
  source: text({ maxLength: 120 }),
});

export const createClientAction = adminAction(clientFields, async (input, { db }) => {
  const client = await createClient(db, input);
  redirect(`/admin/clients/${client._id.toHexString()}`);
});

export const updateClientAction = adminAction(
  clientFields.extend({ id: idSchema, version: versionSchema }),
  async ({ id, version, ...input }, { db }) => {
    const result = await updateClient(db, new ObjectId(id), version, input);
    if (!result.ok) return fail(result.reason === "conflict" ? CONFLICT : NOT_FOUND);
    redirect(`/admin/clients/${id}`);
  },
);

export const setClientStatusAction = adminAction(
  z.object({ id: idSchema, status: z.enum(CLIENT_STATUSES) }),
  async (input, { db }) => {
    if (!(await setClientStatus(db, new ObjectId(input.id), input.status))) return fail(NOT_FOUND);
    refresh();
    return ok(null, `Marked as ${CLIENT_STATUS_LABELS[input.status].toLowerCase()}.`);
  },
);

// --- The log -----------------------------------------------------------------------------------------------

export const addActivityAction = adminAction(
  z.object({
    clientId: idSchema,
    projectId: optionalIdSchema,
    kind: z.enum(ACTIVITY_KINDS),
    body: requiredText(5000, "Write what happened.", true),
    date: dateSchema,
    time: timeSchema,
  }),
  async (input, { db }) => {
    const at = now();
    const date = input.date ?? todayIn(ADMIN_TIME_ZONE, at);
    const when = input.time
      ? zonedInstant(date, input.time, ADMIN_TIME_ZONE)
      : input.date
        ? zonedInstant(date, "12:00", ADMIN_TIME_ZONE)
        : at;
    if (!when) return fieldError("time", "That time does not exist on that day.");
    const activity = await addActivity(
      db,
      {
        clientId: new ObjectId(input.clientId),
        projectId: input.projectId ? new ObjectId(input.projectId) : null,
        kind: input.kind,
        body: input.body,
        at: when,
      },
      at,
    );
    if (!activity) return fail(NOT_FOUND);
    refresh();
    return ok(null, "Added to the log.");
  },
);

export const deleteActivityAction = adminAction(z.object({ id: idSchema }), async (input, { db }) => {
  if (!(await deleteActivity(db, new ObjectId(input.id)))) return fail("That entry no longer exists.");
  refresh();
  return ok(null, "Entry deleted.");
});

// --- Inbox messages ------------------------------------------------------------------------------------------

export const createClientFromInquiryAction = adminAction(
  z.object({ inquiryId: idSchema }),
  async (input, { db }) => {
    const inquiry = await getInquiry(db, new ObjectId(input.inquiryId));
    if (!inquiry) return fail("This message no longer exists.");
    if (inquiry.clientId) return fail("This message already belongs to a client.");
    if (inquiry.status === "spam") return fail("This message is in spam. Move it back to the inbox first.");
    const client = await createClientFromInquiry(db, inquiry);
    refresh();
    return ok({ id: client._id.toHexString() }, `${client.name} is now a client.`);
  },
);

export const linkInquiryAction = adminAction(
  z.object({ inquiryId: idSchema, clientId: idSchema }),
  async (input, { db }) => {
    const client = await getClient(db, new ObjectId(input.clientId));
    if (!client) return fail(NOT_FOUND);
    if (!(await linkInquiry(db, new ObjectId(input.inquiryId), client._id)))
      return fail("This message no longer exists.");
    refresh();
    return ok(null, `Linked to ${client.name}.`);
  },
);

export const unlinkInquiryAction = adminAction(z.object({ inquiryId: idSchema }), async (input, { db }) => {
  if (!(await unlinkInquiry(db, new ObjectId(input.inquiryId))))
    return fail("This message no longer exists.");
  refresh();
  return ok(null, "No longer linked to the client.");
});

// --- Privacy -------------------------------------------------------------------------------------------------

function fileSlug(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "client"
  );
}

// A copy of everything stored about a client (a data request, or before deleting), as JSON.
export const exportClientAction = adminAction(
  z.object({ id: idSchema }),
  async (input, { db, user, client: requester }) => {
    const at = now();
    const data = await exportClient(db, new ObjectId(input.id), at);
    if (!data) return fail(NOT_FOUND);
    await audit(db, {
      action: "clients.client.exported",
      actorId: user._id,
      ip: requester.ip,
      userAgent: requester.userAgent,
      details: { client: input.id },
    });
    return ok({
      filename: `client-${fileSlug(data.client.name)}-${todayIn(ADMIN_TIME_ZONE, at)}.json`,
      json: JSON.stringify(data, null, 2),
    });
  },
  { sudo: true },
);

export const deleteClientAction = adminAction(
  z.object({ id: idSchema, confirm: z.string().max(500) }),
  async (input, { db, user, client: requester }) => {
    const id = new ObjectId(input.id);
    const client = await getClient(db, id);
    if (!client) return fail(NOT_FOUND);
    if (input.confirm.trim() !== client.name) {
      return fieldError("confirm", "Type the client's name exactly as it is shown.");
    }
    const deleted = await deleteClient(db, id);
    if (!deleted) return fail(NOT_FOUND);
    await audit(db, {
      action: "clients.client.deleted",
      actorId: user._id,
      ip: requester.ip,
      userAgent: requester.userAgent,
      details: { client: input.id, ...deleted },
    });
    redirect("/admin/clients");
  },
  { sudo: true },
);

// --- The client portal ------------------------------------------------------------------------------------------

// Turns the portal on and emails the client a link that works for a week.
export const inviteToPortalAction = adminAction(z.object({ id: idSchema }), async (input, { db }) => {
  const result = await inviteToPortal(db, new ObjectId(input.id), notifyContext());
  if (!result.ok) return fail(result.message);
  if (result.emailed) sendQueuedSoon();
  refresh();
  return ok(
    null,
    result.emailed
      ? `Invitation sent to ${result.client.email}.`
      : "The portal is on, but email isn't set up, so the invitation couldn't be sent.",
  );
});

// Turning the portal off signs the client out everywhere.
export const setPortalAccessAction = adminAction(
  z.object({ id: idSchema, enabled: z.boolean() }),
  async (input, { db }) => {
    if (!(await setPortalAccess(db, new ObjectId(input.id), input.enabled))) return fail(NOT_FOUND);
    refresh();
    return ok(null, input.enabled ? "The portal is on." : "The portal is off, and the client is signed out.");
  },
);

export const endPortalSessionsAction = adminAction(z.object({ id: idSchema }), async (input, { db }) => {
  const count = await endClientSessions(db, new ObjectId(input.id));
  refresh();
  return ok(null, count ? "Signed out everywhere." : "The client wasn't signed in anywhere.");
});

// A data request answered: done (the copy sent, the data deleted) or declined, with a note for the record.
export const resolvePrivacyRequestAction = adminAction(
  z.object({
    id: idSchema,
    status: z.enum(["done", "declined"]),
    resolution: text({ maxLength: 500 }).transform((value) => value ?? ""),
  }),
  async (input, { db }) => {
    const resolved = await resolvePrivacyRequest(db, new ObjectId(input.id), input.status, input.resolution);
    if (!resolved) return fail("This request was already answered.");
    refresh();
    return ok(null, input.status === "done" ? "Marked as done." : "Marked as declined.");
  },
);
