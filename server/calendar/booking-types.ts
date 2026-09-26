import "server-only";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import { rankBetween } from "@/lib/rank";
import { bookingTypes, meetings } from "@/server/calendar/settings";
import type { BookingQuestion, BookingTypeDoc, LocationKind, Visibility } from "@/server/calendar/types";
import { now } from "@/server/clock";

// Booking types: what a visitor can book (an intro call, a check-in), how long it takes, where it happens
// and whether the owner confirms it first.

export type BookingTypeInput = {
  slug: string;
  title: string;
  description: string;
  durationMinutes: number;
  visibility: Visibility;
  requiresApproval: boolean;
  location: { kind: LocationKind; details: string };
  questions: { label: string; required: boolean }[];
  active: boolean;
};

export const MAX_QUESTIONS = 5;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function questionsOf(
  input: BookingTypeInput["questions"],
  previous: BookingQuestion[] = [],
): BookingQuestion[] {
  // A question keeps its id while its position holds, so answers stay attached to it.
  return input.slice(0, MAX_QUESTIONS).map((question, index) => ({
    id: previous[index]?.id ?? randomUUID(),
    label: question.label,
    required: question.required,
  }));
}

// The secret part of a secret type's link: 128 random bits.
export function newLinkKey(): string {
  return randomBytes(16).toString("base64url");
}

// "/book/project-check-in?key=…": a secret type's link carries its key.
export function bookingPath(type: Pick<BookingTypeDoc, "slug" | "visibility" | "linkKey">): string {
  const key = type.visibility === "secret" && type.linkKey ? `?key=${type.linkKey}` : "";
  return `/book/${type.slug}${key}`;
}

function keysMatch(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class SlugTakenError extends Error {
  constructor() {
    super("Another booking type uses that address.");
    this.name = "SlugTakenError";
  }
}

const DUPLICATE_KEY = 11000;

function isDuplicate(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === DUPLICATE_KEY;
}

export async function createBookingType(
  db: Db,
  input: BookingTypeInput,
  at: Date = now(),
): Promise<BookingTypeDoc> {
  const last = await bookingTypes(db)
    .find({}, { projection: { rank: 1 } })
    .sort({ rank: -1 })
    .limit(1)
    .next();
  const doc: BookingTypeDoc = {
    _id: new ObjectId(),
    ...input,
    questions: questionsOf(input.questions),
    linkKey: input.visibility === "secret" ? newLinkKey() : null,
    rank: rankBetween(last?.rank ?? null, null),
    createdAt: at,
    updatedAt: at,
  };
  try {
    await bookingTypes(db).insertOne(doc);
  } catch (error) {
    if (isDuplicate(error)) throw new SlugTakenError();
    throw error;
  }
  return doc;
}

export async function updateBookingType(
  db: Db,
  id: ObjectId,
  input: BookingTypeInput,
  at: Date = now(),
): Promise<BookingTypeDoc | null> {
  const current = await bookingTypes(db).findOne({ _id: id });
  if (!current) return null;
  try {
    return await bookingTypes(db).findOneAndUpdate(
      { _id: id },
      {
        $set: {
          ...input,
          questions: questionsOf(input.questions, current.questions),
          // A type made secret gets a key; one that already has a key keeps it, so its link keeps working.
          linkKey: current.linkKey ?? (input.visibility === "secret" ? newLinkKey() : null),
          updatedAt: at,
        },
      },
      { returnDocument: "after" },
    );
  } catch (error) {
    if (isDuplicate(error)) throw new SlugTakenError();
    throw error;
  }
}

export async function listBookingTypes(db: Db, { publicOnly = false } = {}): Promise<BookingTypeDoc[]> {
  const filter = publicOnly ? { active: true, visibility: "public" as const } : {};
  return bookingTypes(db).find(filter).sort({ rank: 1, _id: 1 }).limit(100).toArray();
}

// A type that can be booked through its link: an active public type, or a secret one with its key.
export async function bookableType(
  db: Db,
  slug: string,
  key: string | null = null,
): Promise<BookingTypeDoc | null> {
  if (!SLUG_PATTERN.test(slug) || slug.length > 60) return null;
  const type = await bookingTypes(db).findOne({ slug, active: true });
  if (!type || type.visibility === "public") return type;
  return type.linkKey && key && keysMatch(type.linkKey, key) ? type : null;
}

// A new key for a secret type's link: links shared before stop working.
export async function rotateLinkKey(db: Db, id: ObjectId, at: Date = now()): Promise<BookingTypeDoc | null> {
  return bookingTypes(db).findOneAndUpdate(
    { _id: id },
    { $set: { linkKey: newLinkKey(), updatedAt: at } },
    { returnDocument: "after" },
  );
}

export async function getBookingType(db: Db, id: ObjectId): Promise<BookingTypeDoc | null> {
  return bookingTypes(db).findOne({ _id: id });
}

// Meetings keep their own copy of the title and duration, so deleting a type leaves them as they were.
export async function deleteBookingType(db: Db, id: ObjectId): Promise<boolean> {
  const deleted = await bookingTypes(db).deleteOne({ _id: id });
  if (deleted.deletedCount === 1)
    await meetings(db).updateMany({ bookingTypeId: id }, { $set: { bookingTypeId: null } });
  return deleted.deletedCount === 1;
}

// How many meetings each type has, by the type's id.
export async function meetingCountsByType(db: Db): Promise<Map<string, number>> {
  const rows = await meetings(db)
    .aggregate<{ _id: ObjectId; count: number }>([
      { $match: { bookingTypeId: { $ne: null } } },
      { $group: { _id: "$bookingTypeId", count: { $sum: 1 } } },
    ])
    .toArray();
  return new Map(rows.map((row) => [row._id.toHexString(), row.count]));
}
