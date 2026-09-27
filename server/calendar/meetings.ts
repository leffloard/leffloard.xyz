import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { MongoServerError, ObjectId, type ClientSession, type Db } from "mongodb";
import type { Availability } from "@/lib/booking/availability";
import {
  availableSlots,
  blockedRange,
  cellsFor,
  heldRange,
  ownerDateOf,
  type Busy,
} from "@/lib/booking/slots";
import { addDays, todayIn } from "@/lib/intake/time";
import { blocks, bookingDays, getCalendarSettings, meetings, slotLocks } from "@/server/calendar/settings";
import type { LocationKind, MeetingDoc, MeetingStatus } from "@/server/calendar/types";
import { now } from "@/server/clock";
import { inTransaction } from "@/server/db/transaction";
import { DecryptionError, decryptSecret, encryptSecret } from "@/server/security/encryption";

// Meetings and the rules that keep the calendar consistent. A meeting holds its 15-minute cells as
// documents with the cell as their id (slot_locks), and each day's count sits in one document
// (booking_days); both are written in the same transaction as the meeting. Two bookings of the same time
// can therefore never both succeed, and a full day cannot be overbooked by two visitors at once.

export class SlotTakenError extends Error {
  constructor() {
    super("That time was just taken. Pick another one.");
    this.name = "SlotTakenError";
  }
}

export class DayFullError extends Error {
  constructor() {
    super("That day is fully booked. Pick another day.");
    this.name = "DayFullError";
  }
}

const DUPLICATE_KEY = 11000;
const DAY_MS = 86_400_000;
// Bookings are deleted 24 months after the meeting (see the privacy notice).
export const MEETING_RETENTION_MS = 730 * DAY_MS;
const ACTIVE: MeetingStatus[] = ["requested", "confirmed"];

function isDuplicateKey(error: unknown): boolean {
  if (!(error instanceof MongoServerError)) return false;
  if (error.code === DUPLICATE_KEY) return true;
  const writeErrors = (error as { writeErrors?: { code?: number }[] }).writeErrors;
  return Array.isArray(writeErrors) && writeErrors.some((write) => write.code === DUPLICATE_KEY);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// The secret in a guest's reschedule-and-cancel link. Only its hash is stored.
export function newManageToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

// A Jitsi Meet room with a name nobody can guess.
export function jitsiRoom(): string {
  return `https://meet.jit.si/leffloard-${randomBytes(10).toString("hex")}`;
}

async function countDay(
  db: Db,
  date: string,
  cap: number,
  expiresAt: Date,
  session: ClientSession,
): Promise<void> {
  try {
    await bookingDays(db).updateOne(
      cap > 0 ? { _id: date, count: { $lt: cap } } : { _id: date },
      { $inc: { count: 1 }, $max: { expiresAt } },
      { upsert: true, session },
    );
  } catch (error) {
    // The day exists and is full, so the upsert tried to create it a second time.
    if (cap > 0 && isDuplicateKey(error)) throw new DayFullError();
    throw error;
  }
}

async function uncountDay(db: Db, date: string, session: ClientSession): Promise<void> {
  await bookingDays(db).updateOne({ _id: date, count: { $gt: 0 } }, { $inc: { count: -1 } }, { session });
}

async function lockCells(
  db: Db,
  cells: string[],
  meetingId: ObjectId,
  expiresAt: Date,
  session: ClientSession,
): Promise<void> {
  try {
    await slotLocks(db).insertMany(
      cells.map((cell) => ({ _id: cell, meetingId, expiresAt })),
      { session, ordered: true },
    );
  } catch (error) {
    if (isDuplicateKey(error)) throw new SlotTakenError();
    throw error;
  }
}

export type NewMeeting = {
  bookingTypeId: ObjectId | null;
  title: string;
  startsAt: Date;
  durationMinutes: number;
  timeZone: string;
  status: "requested" | "confirmed";
  name: string;
  email: string;
  notes: string;
  answers: { label: string; value: string }[];
  location: { kind: LocationKind; details: string };
  clientId: ObjectId | null;
  source: "booking" | "admin";
  ownerNote?: string;
  notifyGuest?: boolean; // default true
};

export type Booked = { meeting: MeetingDoc; token: string };

/**
 * Stores a meeting and holds its time. Throws SlotTakenError when any of its cells is held already, and
 * DayFullError when `enforceCap` is set and the day has reached the daily limit.
 */
export async function createMeeting(
  db: Db,
  input: NewMeeting,
  rules: Pick<Availability, "timeZone" | "bufferMinutes" | "dailyCap">,
  { enforceCap }: { enforceCap: boolean },
  at: Date = now(),
): Promise<Booked> {
  const { token, hash } = newManageToken();
  const endsAt = new Date(input.startsAt.getTime() + input.durationMinutes * 60_000);
  const meeting: MeetingDoc = {
    _id: new ObjectId(),
    bookingTypeId: input.bookingTypeId,
    title: input.title,
    startsAt: input.startsAt,
    endsAt,
    durationMinutes: input.durationMinutes,
    bufferMinutes: rules.bufferMinutes,
    ownerDate: ownerDateOf(input.startsAt, rules),
    timeZone: input.timeZone,
    status: input.status,
    name: input.name,
    email: input.email,
    notes: input.notes,
    answers: input.answers,
    location: {
      kind: input.location.kind,
      details: input.location.details,
      url: input.location.kind === "jitsi" ? jitsiRoom() : null,
    },
    clientId: input.clientId,
    manageTokenHash: hash,
    manageTokenSealed: "",
    source: input.source,
    ownerNote: input.ownerNote ?? "",
    sequence: 0,
    scheduledAt: at,
    notifyGuest: input.notifyGuest ?? true,
    reminderSentAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: at,
    updatedAt: at,
    purgeAt: new Date(endsAt.getTime() + MEETING_RETENTION_MS),
  };
  meeting.manageTokenSealed = encryptSecret(token, `meeting:${meeting._id.toHexString()}`);
  const holdUntil = new Date(endsAt.getTime() + DAY_MS);
  const cells = cellsFor(meeting.startsAt, meeting.durationMinutes, meeting.bufferMinutes);
  await inTransaction(db, async (session) => {
    await countDay(db, meeting.ownerDate, enforceCap ? rules.dailyCap : 0, holdUntil, session);
    await lockCells(db, cells, meeting._id, holdUntil, session);
    await meetings(db).insertOne(meeting, { session });
  });
  return { meeting, token };
}

export async function getMeeting(db: Db, id: ObjectId): Promise<MeetingDoc | null> {
  return meetings(db).findOne({ _id: id });
}

// The secret of a meeting's reschedule-and-cancel link, for emails sent after the booking.
export function manageTokenOf(meeting: Pick<MeetingDoc, "_id" | "manageTokenSealed">): string {
  return decryptSecret(meeting.manageTokenSealed, `meeting:${meeting._id.toHexString()}`);
}

// The same for pages, which show the link only if they can: null when the key that sealed it has been
// retired (the guest still has the link in their emails).
export function readableManageToken(meeting: Pick<MeetingDoc, "_id" | "manageTokenSealed">): string | null {
  try {
    return manageTokenOf(meeting);
  } catch (error) {
    if (error instanceof DecryptionError) return null;
    throw error;
  }
}

export async function findMeetingByToken(db: Db, token: string): Promise<MeetingDoc | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return meetings(db).findOne({ manageTokenHash: hashToken(token) });
}

// Moves a meeting to a new start, keeping its length. The old time is released in the same transaction.
export async function rescheduleMeeting(
  db: Db,
  id: ObjectId,
  startsAt: Date,
  rules: Pick<Availability, "timeZone" | "bufferMinutes" | "dailyCap">,
  { enforceCap }: { enforceCap: boolean },
  at: Date = now(),
): Promise<MeetingDoc | null> {
  return inTransaction(db, async (session) => {
    const current = await meetings(db).findOne({ _id: id, status: { $in: ACTIVE } }, { session });
    if (!current) return null;
    const endsAt = new Date(startsAt.getTime() + current.durationMinutes * 60_000);
    const ownerDate = ownerDateOf(startsAt, rules);
    const holdUntil = new Date(endsAt.getTime() + DAY_MS);
    await slotLocks(db).deleteMany({ meetingId: id }, { session });
    if (ownerDate !== current.ownerDate) {
      await uncountDay(db, current.ownerDate, session);
      await countDay(db, ownerDate, enforceCap ? rules.dailyCap : 0, holdUntil, session);
    }
    await lockCells(
      db,
      cellsFor(startsAt, current.durationMinutes, rules.bufferMinutes),
      id,
      holdUntil,
      session,
    );
    return meetings(db).findOneAndUpdate(
      { _id: id },
      {
        $set: {
          startsAt,
          endsAt,
          ownerDate,
          bufferMinutes: rules.bufferMinutes,
          scheduledAt: at,
          reminderSentAt: null,
          updatedAt: at,
          purgeAt: new Date(endsAt.getTime() + MEETING_RETENTION_MS),
        },
        $inc: { sequence: 1 },
      },
      { session, returnDocument: "after" },
    );
  });
}

// A requested meeting confirmed by the owner. Null when it is no longer waiting. SEQUENCE goes up, so the
// confirmed invite replaces a tentative one the guest may have added to their calendar.
export async function approveMeeting(db: Db, id: ObjectId, at: Date = now()): Promise<MeetingDoc | null> {
  return meetings(db).findOneAndUpdate(
    { _id: id, status: "requested" },
    { $set: { status: "confirmed", updatedAt: at }, $inc: { sequence: 1 } },
    { returnDocument: "after" },
  );
}

/**
 * Ends a meeting that was waiting or confirmed: declined (a request the owner turned down) or cancelled
 * (by either side). Its time is free again at once. Null when it had already ended.
 */
export async function endMeeting(
  db: Db,
  id: ObjectId,
  outcome: { status: "declined" | "cancelled"; by: "guest" | "owner"; reason: string | null },
  at: Date = now(),
): Promise<MeetingDoc | null> {
  return inTransaction(db, async (session) => {
    const ended = await meetings(db).findOneAndUpdate(
      { _id: id, status: { $in: outcome.status === "declined" ? ["requested"] : ACTIVE } },
      {
        $set: {
          status: outcome.status,
          cancelledBy: outcome.by,
          cancelReason: outcome.reason,
          updatedAt: at,
        },
        $inc: { sequence: 1 },
      },
      { session, returnDocument: "after" },
    );
    if (!ended) return null;
    await slotLocks(db).deleteMany({ meetingId: id }, { session });
    await uncountDay(db, ended.ownerDate, session);
    return ended;
  });
}

export async function setOwnerNote(
  db: Db,
  id: ObjectId,
  note: string,
  at: Date = now(),
): Promise<MeetingDoc | null> {
  return meetings(db).findOneAndUpdate(
    { _id: id },
    { $set: { ownerNote: note, updatedAt: at } },
    { returnDocument: "after" },
  );
}

export async function linkMeetingClient(
  db: Db,
  id: ObjectId,
  clientId: ObjectId | null,
  at: Date = now(),
): Promise<MeetingDoc | null> {
  return meetings(db).findOneAndUpdate(
    { _id: id },
    { $set: { clientId, updatedAt: at } },
    { returnDocument: "after" },
  );
}

// --- What is taken ---------------------------------------------------------------------------------------

// Meetings and blocks that touch [from, to), widened by what they keep free around them.
export async function busyRanges(
  db: Db,
  from: Date,
  to: Date,
  bufferMinutes: number,
  exceptMeetingId: ObjectId | null = null,
): Promise<Busy[]> {
  const margin = 2 * 3600_000; // more than any buffer
  const [meetingDocs, blockDocs] = await Promise.all([
    meetings(db)
      .find(
        {
          status: { $in: ACTIVE },
          startsAt: { $lt: to },
          endsAt: { $gt: new Date(from.getTime() - margin) },
          ...(exceptMeetingId ? { _id: { $ne: exceptMeetingId } } : {}),
        },
        { projection: { startsAt: 1, durationMinutes: 1, bufferMinutes: 1 } },
      )
      .toArray(),
    blocks(db)
      .find(
        { startsAt: { $lt: new Date(to.getTime() + margin) }, endsAt: { $gt: from } },
        { projection: { startsAt: 1, endsAt: 1 } },
      )
      .toArray(),
  ]);
  return [
    ...meetingDocs.map((meeting) =>
      heldRange(meeting.startsAt, meeting.durationMinutes, meeting.bufferMinutes),
    ),
    ...blockDocs.map((block) => blockedRange({ start: block.startsAt, end: block.endsAt }, bufferMinutes)),
  ];
}

export async function dayCounts(db: Db, fromDate: string, toDate: string): Promise<Record<string, number>> {
  const days = await bookingDays(db)
    .find({ _id: { $gte: fromDate, $lte: toDate } })
    .toArray();
  return Object.fromEntries(days.map((day) => [day._id, day.count]));
}

export type OpenSlots = { slots: Date[]; rules: Availability };

/**
 * The start times open for a meeting of this length now. When rescheduling, the meeting's own time and
 * its place in the day's count don't stand in its way.
 */
export async function openSlots(
  db: Db,
  durationMinutes: number,
  at: Date = now(),
  moving: Pick<MeetingDoc, "_id" | "ownerDate"> | null = null,
): Promise<OpenSlots> {
  const settings = await getCalendarSettings(db);
  const to = new Date(at.getTime() + (settings.horizonDays + 1) * DAY_MS);
  const firstDate = todayIn(settings.timeZone, at);
  const [busy, counts] = await Promise.all([
    busyRanges(db, at, to, settings.bufferMinutes, moving?._id ?? null),
    dayCounts(db, firstDate, addDays(firstDate, settings.horizonDays + 1)),
  ]);
  if (moving && counts[moving.ownerDate]) counts[moving.ownerDate] = counts[moving.ownerDate]! - 1;
  return {
    slots: availableSlots({ availability: settings, durationMinutes, busy, dayCounts: counts, now: at }),
    rules: settings,
  };
}

// --- Lists ---------------------------------------------------------------------------------------------------

export async function meetingsBetween(
  db: Db,
  from: Date,
  to: Date,
  statuses: MeetingStatus[] = ACTIVE,
): Promise<MeetingDoc[]> {
  return meetings(db)
    .find({ status: { $in: statuses }, startsAt: { $lt: to }, endsAt: { $gt: from } })
    .sort({ startsAt: 1 })
    .limit(1000)
    .toArray();
}

export async function upcomingMeetings(db: Db, at: Date = now(), limit = 10): Promise<MeetingDoc[]> {
  return meetings(db)
    .find({ status: { $in: ACTIVE }, endsAt: { $gt: at } })
    .sort({ startsAt: 1 })
    .limit(limit)
    .toArray();
}

export async function countRequests(db: Db, at: Date = now()): Promise<number> {
  return meetings(db).countDocuments({ status: "requested", endsAt: { $gt: at } });
}

export async function meetingsForClient(db: Db, clientId: ObjectId, limit = 50): Promise<MeetingDoc[]> {
  return meetings(db).find({ clientId }).sort({ startsAt: -1 }).limit(limit).toArray();
}
