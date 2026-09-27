import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "mongodb";
import { DEFAULT_AVAILABILITY, type Availability } from "@/lib/booking/availability";
import type {
  BlockDoc,
  BookingDayDoc,
  BookingTypeDoc,
  CalendarSettingsDoc,
  MeetingDoc,
  SlotLockDoc,
} from "@/server/calendar/types";
import { now } from "@/server/clock";

// The calendar's collections, and its settings: the owner's hours and the private feed's token.

export function calendarSettings(db: Db) {
  return db.collection<CalendarSettingsDoc>("settings");
}
export function bookingTypes(db: Db) {
  return db.collection<BookingTypeDoc>("booking_types");
}
export function meetings(db: Db) {
  return db.collection<MeetingDoc>("meetings");
}
export function blocks(db: Db) {
  return db.collection<BlockDoc>("calendar_blocks");
}
export function slotLocks(db: Db) {
  return db.collection<SlotLockDoc>("slot_locks");
}
export function bookingDays(db: Db) {
  return db.collection<BookingDayDoc>("booking_days");
}

export type CalendarSettings = Availability & { feedEnabled: boolean; version: number };

// The saved settings, or the defaults (version 0) until the owner saves them.
export async function getCalendarSettings(db: Db): Promise<CalendarSettings> {
  const doc = await calendarSettings(db).findOne({ _id: "calendar" });
  if (!doc) return { ...DEFAULT_AVAILABILITY, feedEnabled: false, version: 0 };
  return {
    timeZone: doc.timeZone,
    weekly: doc.weekly,
    overrides: doc.overrides,
    bufferMinutes: doc.bufferMinutes,
    minNoticeMinutes: doc.minNoticeMinutes,
    horizonDays: doc.horizonDays,
    dailyCap: doc.dailyCap,
    stepMinutes: doc.stepMinutes,
    feedEnabled: doc.feedTokenHash !== null,
    version: doc.version,
  };
}

export class StaleSettingsError extends Error {
  constructor() {
    super("The hours were changed somewhere else since you opened them. Reload to see them.");
    this.name = "StaleSettingsError";
  }
}

// Saves the hours and rules. `version` is the one the form was opened with (0 before the first save).
export async function saveAvailability(
  db: Db,
  availability: Availability,
  version: number,
  at: Date = now(),
): Promise<CalendarSettings> {
  if (version === 0) {
    const inserted = await calendarSettings(db).updateOne(
      { _id: "calendar" },
      { $setOnInsert: { ...availability, feedTokenHash: null, updatedAt: at, version: 1 } },
      { upsert: true },
    );
    if (inserted.upsertedCount !== 1) throw new StaleSettingsError();
  } else {
    const updated = await calendarSettings(db).updateOne(
      { _id: "calendar", version },
      { $set: { ...availability, updatedAt: at }, $inc: { version: 1 } },
    );
    if (updated.matchedCount !== 1) throw new StaleSettingsError();
  }
  return getCalendarSettings(db);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// A new secret for the feed's address; the old address stops working at once. Returns the secret.
export async function rotateFeedToken(db: Db, at: Date = now()): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await calendarSettings(db).updateOne(
    { _id: "calendar" },
    {
      $set: { feedTokenHash: hashToken(token), updatedAt: at },
      $setOnInsert: { ...DEFAULT_AVAILABILITY, version: 1 },
    },
    { upsert: true },
  );
  return token;
}

export async function disableFeed(db: Db, at: Date = now()): Promise<void> {
  await calendarSettings(db).updateOne({ _id: "calendar" }, { $set: { feedTokenHash: null, updatedAt: at } });
}

export async function feedTokenMatches(db: Db, token: string): Promise<boolean> {
  const doc = await calendarSettings(db).findOne({ _id: "calendar" }, { projection: { feedTokenHash: 1 } });
  if (!doc?.feedTokenHash || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) return false;
  return timingSafeEqual(Buffer.from(doc.feedTokenHash, "hex"), Buffer.from(hashToken(token), "hex"));
}
