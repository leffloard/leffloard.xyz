import "server-only";
import type { Db, ObjectId } from "mongodb";
import type { BookingDetails } from "@/lib/booking/form";
import { offersSlot } from "@/lib/booking/slots";
import { bookingPath, getBookingType } from "@/server/calendar/booking-types";
import {
  bookedEmail,
  cancelledEmail,
  declinedEmail,
  ownerMeetingDiscord,
  ownerMeetingEmail,
  reminderEmail,
  requestedEmail,
  requestMovedEmail,
  rescheduledEmail,
  type MeetingMailContext,
  type OwnerEvent,
} from "@/server/calendar/emails";
import {
  approveMeeting,
  createMeeting,
  DayFullError,
  endMeeting,
  manageTokenOf,
  openSlots,
  rescheduleMeeting,
  SlotTakenError,
} from "@/server/calendar/meetings";
import { meetings } from "@/server/calendar/settings";
import type { BookingTypeDoc, MeetingDoc } from "@/server/calendar/types";
import { touchClient } from "@/server/clients/store";
import { now } from "@/server/clock";
import { log } from "@/server/log";
import type { Channels } from "@/server/notify/channels";
import { enqueue } from "@/server/notify/outbox";
import type { EmailMessage } from "@/server/notify/templates";
import { clients } from "@/server/work/collections";

// Bookings from start to end: a visitor books, reschedules or cancels through their link; the owner
// confirms, declines, moves or cancels in the admin. Every change tells the other side through the outbox.

export type NotifyContext = { siteUrl: string; channels: Channels };

export type BookingProblem = "unavailable" | "taken" | "full" | "gone";

export type BookingResult =
  { ok: true; meeting: MeetingDoc; token: string } | { ok: false; problem: BookingProblem };

export const PROBLEM_MESSAGES: Record<BookingProblem, string> = {
  unavailable: "That time is no longer available. Pick another one.",
  taken: "That time was just taken. Pick another one.",
  full: "That day is now fully booked. Pick another day.",
  gone: "This booking has already ended or been cancelled.",
};

function mailContext(meeting: MeetingDoc, notify: NotifyContext, token?: string): MeetingMailContext {
  let manageToken = token ?? null;
  if (!manageToken) {
    try {
      manageToken = manageTokenOf(meeting);
    } catch (error) {
      // An encryption key was retired: the email goes out without the link.
      log.warn({ err: error, meeting: meeting._id.toHexString() }, "manage link could not be decrypted");
    }
  }
  return {
    siteUrl: notify.siteUrl,
    ownerEmail: notify.channels.ownerEmail,
    manageUrl: manageToken ? `${notify.siteUrl}/meeting/${manageToken}` : null,
  };
}

async function toGuest(
  db: Db,
  meeting: MeetingDoc,
  notify: NotifyContext,
  message: EmailMessage,
  event: string,
) {
  if (!notify.channels.email) return;
  await enqueue(db, {
    channel: "email",
    payload: message,
    dedupeKey: `meeting:${meeting._id.toHexString()}:${event}`,
    label: `${event[0]!.toUpperCase()}${event.slice(1).replace(/:\d+$/, "")} email to ${meeting.name}`,
    ref: { meetingId: meeting._id },
  });
}

async function toOwner(db: Db, meeting: MeetingDoc, notify: NotifyContext, event: OwnerEvent) {
  const key = `meeting:${meeting._id.toHexString()}:owner-${event}:${meeting.sequence}`;
  const label = `${event[0]!.toUpperCase()}${event.slice(1)} alert for ${meeting.title} with ${meeting.name}`;
  if (notify.channels.ownerEmail) {
    await enqueue(db, {
      channel: "email",
      payload: ownerMeetingEmail(meeting, event, { to: notify.channels.ownerEmail, siteUrl: notify.siteUrl }),
      dedupeKey: `${key}:email`,
      label,
      ref: { meetingId: meeting._id },
    });
  }
  if (notify.channels.discordWebhookUrl) {
    await enqueue(db, {
      channel: "discord",
      payload: ownerMeetingDiscord(meeting, event, notify.siteUrl),
      dedupeKey: `${key}:discord`,
      label,
      ref: { meetingId: meeting._id },
    });
  }
}

async function rebookUrl(db: Db, meeting: MeetingDoc, siteUrl: string): Promise<string | null> {
  const type = meeting.bookingTypeId ? await getBookingType(db, meeting.bookingTypeId) : null;
  return type?.active ? `${siteUrl}${bookingPath(type)}` : null;
}

// The client a guest already is, when exactly one client has their address.
async function knownClient(db: Db, email: string, at: Date): Promise<ObjectId | null> {
  const matches = await clients(db)
    .find({ emailKey: email.toLowerCase() }, { projection: { _id: 1 } })
    .limit(2)
    .toArray();
  if (matches.length !== 1) return null;
  await touchClient(db, matches[0]!._id, at, at);
  return matches[0]!._id;
}

// --- The visitor ---------------------------------------------------------------------------------------------

export async function bookFromSite(
  db: Db,
  type: BookingTypeDoc,
  details: BookingDetails,
  notify: NotifyContext,
  at: Date = now(),
): Promise<BookingResult> {
  const { slots, rules } = await openSlots(db, type.durationMinutes, at);
  if (!offersSlot(slots, details.start)) return { ok: false, problem: "unavailable" };
  try {
    const { meeting, token } = await createMeeting(
      db,
      {
        bookingTypeId: type._id,
        title: type.title,
        startsAt: details.start,
        durationMinutes: type.durationMinutes,
        timeZone: details.timeZone,
        status: type.requiresApproval ? "requested" : "confirmed",
        name: details.name,
        email: details.email,
        notes: details.notes,
        answers: details.answers.map(({ label, value }) => ({ label, value })),
        location: type.location,
        clientId: await knownClient(db, details.email, at),
        source: "booking",
      },
      rules,
      { enforceCap: true },
      at,
    );
    const context = mailContext(meeting, notify, token);
    if (meeting.status === "confirmed") {
      await toGuest(db, meeting, notify, bookedEmail(meeting, context), "booked");
      await toOwner(db, meeting, notify, "booked");
    } else {
      await toGuest(db, meeting, notify, requestedEmail(meeting, context), "requested");
      await toOwner(db, meeting, notify, "requested");
    }
    return { ok: true, meeting, token };
  } catch (error) {
    if (error instanceof SlotTakenError) return { ok: false, problem: "taken" };
    if (error instanceof DayFullError) return { ok: false, problem: "full" };
    throw error;
  }
}

// Whether a guest may still change a meeting: it is waiting or confirmed, and has not started.
export function guestCanChange(meeting: MeetingDoc, at: Date = now()): boolean {
  return (meeting.status === "requested" || meeting.status === "confirmed") && meeting.startsAt > at;
}

export async function guestReschedule(
  db: Db,
  meeting: MeetingDoc,
  start: Date,
  notify: NotifyContext,
  at: Date = now(),
): Promise<BookingResult> {
  if (!guestCanChange(meeting, at)) return { ok: false, problem: "gone" };
  const { slots, rules } = await openSlots(db, meeting.durationMinutes, at, meeting);
  if (!offersSlot(slots, start)) return { ok: false, problem: "unavailable" };
  try {
    const moved = await rescheduleMeeting(db, meeting._id, start, rules, { enforceCap: true }, at);
    if (!moved) return { ok: false, problem: "gone" };
    const context = mailContext(moved, notify);
    const email =
      moved.status === "confirmed" ? rescheduledEmail(moved, context) : requestedEmail(moved, context);
    await toGuest(db, moved, notify, email, `rescheduled:${moved.sequence}`);
    await toOwner(db, moved, notify, "rescheduled");
    return { ok: true, meeting: moved, token: "" };
  } catch (error) {
    if (error instanceof SlotTakenError) return { ok: false, problem: "taken" };
    if (error instanceof DayFullError) return { ok: false, problem: "full" };
    throw error;
  }
}

export async function guestCancel(
  db: Db,
  meeting: MeetingDoc,
  reason: string | null,
  notify: NotifyContext,
  at: Date = now(),
): Promise<MeetingDoc | null> {
  if (!guestCanChange(meeting, at)) return null;
  const ended = await endMeeting(db, meeting._id, { status: "cancelled", by: "guest", reason }, at);
  if (!ended) return null;
  const context = mailContext(ended, notify);
  await toGuest(
    db,
    ended,
    notify,
    cancelledEmail(ended, context, await rebookUrl(db, ended, notify.siteUrl)),
    "cancelled",
  );
  await toOwner(db, ended, notify, "cancelled");
  return ended;
}

// --- The owner -------------------------------------------------------------------------------------------------

export async function ownerApprove(db: Db, id: ObjectId, notify: NotifyContext, at: Date = now()) {
  const approved = await approveMeeting(db, id, at);
  if (approved)
    await toGuest(db, approved, notify, bookedEmail(approved, mailContext(approved, notify)), "booked");
  return approved;
}

export async function ownerDecline(
  db: Db,
  id: ObjectId,
  reason: string | null,
  notify: NotifyContext,
  at: Date = now(),
) {
  const declined = await endMeeting(db, id, { status: "declined", by: "owner", reason }, at);
  if (declined) {
    const email = declinedEmail(
      declined,
      mailContext(declined, notify),
      reason,
      await rebookUrl(db, declined, notify.siteUrl),
    );
    await toGuest(db, declined, notify, email, "declined");
  }
  return declined;
}

export async function ownerCancel(
  db: Db,
  id: ObjectId,
  reason: string | null,
  notify: NotifyContext,
  { tellGuest }: { tellGuest: boolean },
  at: Date = now(),
) {
  const cancelled = await endMeeting(db, id, { status: "cancelled", by: "owner", reason }, at);
  if (cancelled && tellGuest) {
    const email = cancelledEmail(
      cancelled,
      mailContext(cancelled, notify),
      await rebookUrl(db, cancelled, notify.siteUrl),
    );
    await toGuest(db, cancelled, notify, email, "cancelled");
  }
  return cancelled;
}

// The owner may move a meeting to any free time, outside the usual hours and past the daily limit too.
export async function ownerReschedule(
  db: Db,
  id: ObjectId,
  start: Date,
  notify: NotifyContext,
  { tellGuest }: { tellGuest: boolean },
  at: Date = now(),
): Promise<BookingResult> {
  const { rules } = await openSlots(db, 15, at);
  try {
    const moved = await rescheduleMeeting(db, id, start, rules, { enforceCap: false }, at);
    if (!moved) return { ok: false, problem: "gone" };
    if (tellGuest) {
      const context = mailContext(moved, notify);
      // A request stays a request: the guest hears of the new time, and the invite comes with the answer.
      const email =
        moved.status === "confirmed" ? rescheduledEmail(moved, context) : requestMovedEmail(moved, context);
      await toGuest(db, moved, notify, email, `rescheduled:${moved.sequence}`);
    }
    return { ok: true, meeting: moved, token: "" };
  } catch (error) {
    if (error instanceof SlotTakenError) return { ok: false, problem: "taken" };
    throw error;
  }
}

export type OwnerMeetingInput = {
  title: string;
  startsAt: Date;
  durationMinutes: number;
  timeZone: string;
  name: string;
  email: string;
  location: MeetingDoc["location"]["kind"];
  locationDetails: string;
  clientId: ObjectId | null;
  ownerNote: string;
  tellGuest: boolean;
};

// A meeting the owner sets up (with a client, say), confirmed at once.
export async function ownerCreate(
  db: Db,
  input: OwnerMeetingInput,
  notify: NotifyContext,
  at: Date = now(),
): Promise<BookingResult> {
  const { rules } = await openSlots(db, input.durationMinutes, at);
  try {
    const { meeting, token } = await createMeeting(
      db,
      {
        bookingTypeId: null,
        title: input.title,
        startsAt: input.startsAt,
        durationMinutes: input.durationMinutes,
        timeZone: input.timeZone,
        status: "confirmed",
        name: input.name,
        email: input.email,
        notes: "",
        answers: [],
        location: { kind: input.location, details: input.locationDetails },
        clientId: input.clientId,
        source: "admin",
        ownerNote: input.ownerNote,
        notifyGuest: input.tellGuest,
      },
      rules,
      { enforceCap: false },
      at,
    );
    if (input.tellGuest)
      await toGuest(db, meeting, notify, bookedEmail(meeting, mailContext(meeting, notify, token)), "booked");
    return { ok: true, meeting, token };
  } catch (error) {
    if (error instanceof SlotTakenError) return { ok: false, problem: "taken" };
    throw error;
  }
}

// --- Reminders -------------------------------------------------------------------------------------------------

const REMINDER_AHEAD_MS = 24 * 3600_000;
// Closer than this to the start, a reminder would arrive too late to help.
const REMINDER_LAST_MS = 3600_000;
// A call booked or moved in the last 12 hours has just had its confirmation.
const RECENTLY_ARRANGED_MS = 12 * 3600_000;

// Emails confirmed guests once, within the day before their meeting: not for a call arranged in the last 12
// hours, nor for one the owner set up without emailing the guest. Moving a meeting allows a new reminder.
export async function sendReminders(db: Db, notify: NotifyContext, at: Date = now()): Promise<number> {
  if (!notify.channels.email) return 0;
  const due = await meetings(db)
    .find({
      status: "confirmed",
      notifyGuest: { $ne: false },
      reminderSentAt: null,
      startsAt: {
        $gt: new Date(at.getTime() + REMINDER_LAST_MS),
        $lte: new Date(at.getTime() + REMINDER_AHEAD_MS),
      },
      scheduledAt: { $lte: new Date(at.getTime() - RECENTLY_ARRANGED_MS) },
    })
    .limit(200)
    .toArray();
  let sent = 0;
  for (const meeting of due) {
    // Claimed once, and only while still confirmed at the same time: a cancel or a move in between wins.
    const claimed = await meetings(db).findOneAndUpdate(
      { _id: meeting._id, status: "confirmed", reminderSentAt: null, startsAt: meeting.startsAt },
      { $set: { reminderSentAt: at } },
      { returnDocument: "after" },
    );
    if (!claimed) continue;
    await toGuest(
      db,
      claimed,
      notify,
      reminderEmail(claimed, mailContext(claimed, notify), at),
      `reminder:${claimed.sequence}`,
    );
    sent++;
  }
  return sent;
}
