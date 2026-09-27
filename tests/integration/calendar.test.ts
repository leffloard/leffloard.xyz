import type { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AVAILABILITY, type Availability } from "@/lib/booking/availability";
import { createBlock, deleteBlock } from "@/server/calendar/blocks";
import {
  bookableType,
  bookingPath,
  createBookingType,
  deleteBookingType,
  listBookingTypes,
  meetingCountsByType,
  rotateLinkKey,
  SlugTakenError,
  updateBookingType,
  type BookingTypeInput,
} from "@/server/calendar/booking-types";
import {
  approveMeeting,
  createMeeting,
  DayFullError,
  endMeeting,
  findMeetingByToken,
  getMeeting,
  manageTokenOf,
  openSlots,
  readableManageToken,
  rescheduleMeeting,
  SlotTakenError,
  type NewMeeting,
} from "@/server/calendar/meetings";
import {
  disableFeed,
  feedTokenMatches,
  getCalendarSettings,
  rotateFeedToken,
  saveAvailability,
  StaleSettingsError,
} from "@/server/calendar/settings";
import { clientTimeline, createClient, deleteClient, exportClient } from "@/server/clients/store";
import { resetClock } from "@/server/clock";
import { runMigrations } from "@/server/db/migrate";
import { clearEnvCache } from "@/server/env";
import { TEST_ENCRYPTION_KEYS } from "../helpers/env";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

setupTestEnv();
const { db } = setupTestDb();

beforeEach(async () => {
  await runMigrations(db());
});

afterEach(() => resetClock());

// Monday 28 September 2026, 09:00 in Istanbul.
const NOW = new Date("2026-09-28T06:00:00Z");
const RULES: Availability = {
  ...DEFAULT_AVAILABILITY,
  weekly: [[{ start: "17:00", end: "21:00" }], [], [], [], [], [], []],
  minNoticeMinutes: 0,
  horizonDays: 7,
  dailyCap: 0,
  bufferMinutes: 15,
};
const AT = (time: string) => new Date(`2026-09-28T${time}:00Z`);

function meeting(overrides: Partial<NewMeeting> = {}): NewMeeting {
  return {
    bookingTypeId: null,
    title: "Intro call",
    startsAt: AT("14:00"),
    durationMinutes: 30,
    timeZone: "Europe/London",
    status: "confirmed",
    name: "Ada Lovelace",
    email: "ada@example.com",
    notes: "",
    answers: [],
    location: { kind: "jitsi", details: "" },
    clientId: null,
    source: "booking",
    ...overrides,
  };
}

const locks = () =>
  db().collection<{ _id: string; meetingId: ObjectId }>("slot_locks").find().sort({ _id: 1 }).toArray();
const dayCount = async (date: string) =>
  (await db().collection<{ _id: string; count: number }>("booking_days").findOne({ _id: date }))?.count ?? 0;

describe("booking types", () => {
  it("seeds two types, and keeps addresses unique", async () => {
    const seeded = await listBookingTypes(db());
    expect(seeded.map((type) => [type.slug, type.visibility])).toEqual([
      ["intro-call", "public"],
      ["project-check-in", "secret"],
    ]);
    expect((await listBookingTypes(db(), { publicOnly: true })).map((type) => type.slug)).toEqual([
      "intro-call",
    ]);
    // A secret type needs its link's key.
    const secret = seeded[1]!;
    expect(secret.linkKey).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await bookableType(db(), "project-check-in")).toBeNull();
    expect(await bookableType(db(), "project-check-in", "wrong-key-of-the-same-size")).toBeNull();
    expect((await bookableType(db(), "project-check-in", secret.linkKey))?.title).toBe("Project check-in");
    expect(bookingPath(secret)).toBe(`/book/project-check-in?key=${secret.linkKey}`);
    expect(bookingPath(seeded[0]!)).toBe("/book/intro-call");
    const rotated = await rotateLinkKey(db(), secret._id, NOW);
    expect(rotated?.linkKey).not.toBe(secret.linkKey);
    expect(await bookableType(db(), "project-check-in", secret.linkKey)).toBeNull();
    expect(await bookableType(db(), "../etc")).toBeNull();

    const input: BookingTypeInput = {
      slug: "code-review",
      title: "Code review",
      description: "",
      durationMinutes: 60,
      visibility: "public",
      requiresApproval: true,
      location: { kind: "discord", details: "I'll send a Discord invite." },
      questions: [{ label: "Repository?", required: true }],
      active: true,
    };
    const created = await createBookingType(db(), input, NOW);
    expect(created.rank > seeded[1]!.rank).toBe(true);
    expect(created.linkKey).toBeNull();
    await expect(createBookingType(db(), { ...input, title: "Again" })).rejects.toThrow(SlugTakenError);
    await expect(updateBookingType(db(), created._id, { ...input, slug: "intro-call" })).rejects.toThrow(
      SlugTakenError,
    );
    const updated = await updateBookingType(db(), created._id, {
      ...input,
      questions: [
        { label: "Repository link?", required: true },
        { label: "Deadline?", required: false },
      ],
    });
    // The first question keeps its id; the new one gets its own.
    expect(updated?.questions[0]?.id).toBe(created.questions[0]?.id);
    expect(updated?.questions[1]?.id).not.toBe(created.questions[0]?.id);
    // Made secret, it gets a key, and keeps it through later saves.
    const madeSecret = await updateBookingType(db(), created._id, { ...input, visibility: "secret" });
    expect(madeSecret?.linkKey).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const saved = await updateBookingType(db(), created._id, {
      ...input,
      visibility: "secret",
      title: "Review",
    });
    expect(saved?.linkKey).toBe(madeSecret?.linkKey);
    await updateBookingType(db(), created._id, { ...input, active: false });
    expect(await bookableType(db(), "code-review")).toBeNull();
    expect(await deleteBookingType(db(), created._id)).toBe(true);
  });
});

describe("settings", () => {
  it("saves hours with a version, and rotates the feed's secret", async () => {
    expect((await getCalendarSettings(db())).version).toBe(0);
    const saved = await saveAvailability(db(), RULES, 0, NOW);
    expect(saved).toMatchObject({ version: 1, horizonDays: 7, feedEnabled: false });
    await expect(saveAvailability(db(), RULES, 0)).rejects.toThrow(StaleSettingsError);
    expect((await saveAvailability(db(), { ...RULES, dailyCap: 2 }, 1)).dailyCap).toBe(2);
    await expect(saveAvailability(db(), RULES, 1)).rejects.toThrow(StaleSettingsError);

    const token = await rotateFeedToken(db());
    expect(await feedTokenMatches(db(), token)).toBe(true);
    expect(await feedTokenMatches(db(), `${token}x`)).toBe(false);
    const next = await rotateFeedToken(db());
    expect(await feedTokenMatches(db(), token)).toBe(false);
    expect((await getCalendarSettings(db())).feedEnabled).toBe(true);
    await disableFeed(db());
    expect(await feedTokenMatches(db(), next)).toBe(false);
  });
});

describe("meetings", () => {
  it("holds a meeting's cells and its place in the day", async () => {
    const { meeting: booked, token } = await createMeeting(db(), meeting(), RULES, { enforceCap: true }, NOW);
    expect(booked).toMatchObject({ ownerDate: "2026-09-28", bufferMinutes: 15, sequence: 0 });
    expect(booked.location.url).toMatch(/^https:\/\/meet\.jit\.si\/leffloard-[0-9a-f]{20}$/);
    expect((await locks()).map((lock) => lock._id)).toEqual([
      "2026-09-28T14:00Z",
      "2026-09-28T14:15Z",
      "2026-09-28T14:30Z",
    ]);
    expect(await dayCount("2026-09-28")).toBe(1);
    expect((await findMeetingByToken(db(), token))?._id.equals(booked._id)).toBe(true);
    expect(await findMeetingByToken(db(), "not-a-token")).toBeNull();
    expect(booked.manageTokenHash).not.toContain(token);
  });

  it("shows no manage link on pages once the key that sealed it is retired, instead of failing", async () => {
    const { meeting: booked, token } = await createMeeting(db(), meeting(), RULES, { enforceCap: true }, NOW);
    expect(readableManageToken(booked)).toBe(token);
    vi.stubEnv("DATA_ENCRYPTION_KEYS", `2:${Buffer.alloc(32, 9).toString("base64")}`);
    clearEnvCache();
    try {
      expect(() => manageTokenOf(booked)).toThrow();
      expect(readableManageToken(booked)).toBeNull();
    } finally {
      vi.stubEnv("DATA_ENCRYPTION_KEYS", TEST_ENCRYPTION_KEYS);
      clearEnvCache();
    }
  });

  it("books a time once, however many people ask for it at the same moment", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        createMeeting(db(), meeting({ email: `guest${i}@example.com` }), RULES, { enforceCap: true }, NOW),
      ),
    );
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const refused = attempts.filter((attempt) => attempt.status === "rejected");
    expect(
      refused.every((attempt) => (attempt as PromiseRejectedResult).reason instanceof SlotTakenError),
    ).toBe(true);
    expect(await db().collection("meetings").countDocuments()).toBe(1);
    expect(await dayCount("2026-09-28")).toBe(1);
    // A meeting that overlaps only its buffer is refused too.
    await expect(
      createMeeting(db(), meeting({ startsAt: AT("14:30") }), RULES, { enforceCap: true }, NOW),
    ).rejects.toThrow(SlotTakenError);
    await createMeeting(db(), meeting({ startsAt: AT("14:45") }), RULES, { enforceCap: true }, NOW);
  });

  it("keeps to the daily limit when bookings race, unless the owner books", async () => {
    const capped = { ...RULES, dailyCap: 2 };
    const times = ["14:00", "15:00", "16:00", "17:00", "18:00"];
    const attempts = await Promise.allSettled(
      times.map((time) =>
        createMeeting(db(), meeting({ startsAt: AT(time) }), capped, { enforceCap: true }, NOW),
      ),
    );
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(2);
    expect(
      attempts
        .filter((attempt) => attempt.status === "rejected")
        .every((attempt) => (attempt as PromiseRejectedResult).reason instanceof DayFullError),
    ).toBe(true);
    expect(await dayCount("2026-09-28")).toBe(2);
    // The owner can still put a meeting in.
    const taken = new Set((await locks()).map((lock) => lock._id));
    const free = times.find((time) => !taken.has(`2026-09-28T${time}Z`))!;
    await createMeeting(
      db(),
      meeting({ startsAt: AT(free), source: "admin" }),
      capped,
      { enforceCap: false },
      NOW,
    );
    expect(await dayCount("2026-09-28")).toBe(3);
  });

  it("reschedules by moving the hold, and changes nothing when the new time is taken", async () => {
    const first = (await createMeeting(db(), meeting(), RULES, { enforceCap: true }, NOW)).meeting;
    await createMeeting(db(), meeting({ startsAt: AT("16:00") }), RULES, { enforceCap: true }, NOW);

    const moved = await rescheduleMeeting(db(), first._id, AT("14:30"), RULES, { enforceCap: true }, NOW);
    expect(moved).toMatchObject({ sequence: 1, startsAt: AT("14:30"), endsAt: AT("15:00") });
    expect(
      (await locks()).filter((lock) => lock.meetingId.equals(first._id)).map((lock) => lock._id),
    ).toEqual(["2026-09-28T14:30Z", "2026-09-28T14:45Z", "2026-09-28T15:00Z"]);

    await expect(
      rescheduleMeeting(db(), first._id, AT("15:45"), RULES, { enforceCap: true }, NOW),
    ).rejects.toThrow(SlotTakenError);
    const unchanged = await getMeeting(db(), first._id);
    expect(unchanged).toMatchObject({ startsAt: AT("14:30"), sequence: 1 });
    expect((await locks()).filter((lock) => lock.meetingId.equals(first._id))).toHaveLength(3);

    // To another day: the counts follow.
    const tuesday = new Date("2026-09-29T14:00:00Z");
    await rescheduleMeeting(db(), first._id, tuesday, RULES, { enforceCap: true }, NOW);
    expect([await dayCount("2026-09-28"), await dayCount("2026-09-29")]).toEqual([1, 1]);
  });

  it("frees the time when a meeting is declined or cancelled, once", async () => {
    const requested = (
      await createMeeting(db(), meeting({ status: "requested" }), RULES, { enforceCap: true }, NOW)
    ).meeting;
    expect(
      await endMeeting(db(), requested._id, { status: "cancelled", by: "guest", reason: null }),
    ).not.toBeNull();
    expect(await locks()).toEqual([]);
    expect(await dayCount("2026-09-28")).toBe(0);
    expect(
      await endMeeting(db(), requested._id, { status: "cancelled", by: "guest", reason: null }),
    ).toBeNull();
    expect(await dayCount("2026-09-28")).toBe(0);

    const second = (
      await createMeeting(db(), meeting({ status: "requested" }), RULES, { enforceCap: true }, NOW)
    ).meeting;
    // Confirming raises SEQUENCE, so the confirmed invite replaces a tentative one.
    expect(await approveMeeting(db(), second._id)).toMatchObject({ status: "confirmed", sequence: 1 });
    expect(await approveMeeting(db(), second._id)).toBeNull();
    // Only a waiting request can be declined.
    expect(await endMeeting(db(), second._id, { status: "declined", by: "owner", reason: null })).toBeNull();
    const cancelled = await endMeeting(db(), second._id, { status: "cancelled", by: "owner", reason: "Ill" });
    expect(cancelled).toMatchObject({
      status: "cancelled",
      cancelledBy: "owner",
      cancelReason: "Ill",
      sequence: 2, // confirmed, then cancelled
    });
  });

  it("offers only times that are still open, and lets a meeting move within its own time", async () => {
    await saveAvailability(db(), RULES, 0, NOW);
    const before = await openSlots(db(), 30, NOW);
    expect(before.slots.map((slot) => slot.toISOString().slice(11, 16))).toEqual([
      "14:00",
      "14:30",
      "15:00",
      "15:30",
      "16:00",
      "16:30",
      "17:00",
      "17:30",
    ]);
    const booked = (
      await createMeeting(db(), meeting({ startsAt: AT("15:00") }), RULES, { enforceCap: true }, NOW)
    ).meeting;
    const block = await createBlock(db(), {
      title: "Exam prep",
      kind: "focus",
      startsAt: AT("17:00"),
      endsAt: AT("18:00"),
    });
    const after = await openSlots(db(), 30, NOW);
    // 15:00 is taken, 14:30 would run into it, 15:30 into its buffer; the block also keeps 16:30 back.
    expect(after.slots.map((slot) => slot.toISOString().slice(11, 16))).toEqual(["14:00", "16:00"]);
    const forMove = await openSlots(db(), 30, NOW, booked);
    expect(forMove.slots.map((slot) => slot.toISOString().slice(11, 16))).toContain("15:00");
    await deleteBlock(db(), block._id);
    const freed = await openSlots(db(), 30, NOW);
    expect(freed.slots.map((slot) => slot.toISOString().slice(11, 16))).toEqual([
      "14:00",
      "16:00",
      "16:30",
      "17:00",
      "17:30",
    ]);
  });
});

describe("meetings and clients", () => {
  it("puts a client's meetings on their timeline and in their export, and unlinks them on delete", async () => {
    const client = await createClient(
      db(),
      {
        name: "Ada Lovelace",
        company: null,
        email: "ada@example.com",
        phone: null,
        website: null,
        location: null,
        timeZone: "Europe/London",
        currency: "USD",
        status: "lead",
        tags: [],
        notes: "",
        source: null,
      },
      {},
      NOW,
    );
    const [type] = await listBookingTypes(db());
    const booked = (
      await createMeeting(
        db(),
        meeting({ clientId: client._id, bookingTypeId: type!._id }),
        RULES,
        { enforceCap: true },
        NOW,
      )
    ).meeting;

    const timeline = await clientTimeline(db(), client._id);
    expect(timeline[0]).toMatchObject({
      type: "meeting",
      id: booked._id.toHexString(),
      title: "Intro call",
      status: "confirmed",
    });
    const exported = await exportClient(db(), client._id, NOW);
    expect(exported?.meetings.map((item) => item._id.toHexString())).toEqual([booked._id.toHexString()]);
    // The export leaves out the secret behind the guest's manage link.
    expect(exported?.meetings[0]).not.toHaveProperty("manageTokenHash");
    expect(exported?.meetings[0]).not.toHaveProperty("manageTokenSealed");
    expect((await meetingCountsByType(db())).get(type!._id.toHexString())).toBe(1);

    const deleted = await deleteClient(db(), client._id);
    expect(deleted?.meetingsUnlinked).toBe(1);
    const kept = await getMeeting(db(), booked._id);
    expect(kept?.clientId).toBeNull();
    expect(kept?.status).toBe("confirmed");
  });
});
