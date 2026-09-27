import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetClock, setClock } from "@/server/clock";
import { runMigrations } from "@/server/db/migrate";
import {
  addReply,
  changeStatus,
  deleteInquiry,
  getInquiry,
  insertInquiry,
  listInquiries,
  listLabels,
  NotACallError,
  parseInquiryId,
  RETENTION_MS,
  setLabels,
  setNote,
  setSchedule,
  snooze,
  SPAM_RETENTION_MS,
  type InboxQuery,
} from "@/server/inquiries/store";
import { inquiryInput } from "../helpers/inquiry";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

// The inbox, including the v1 admin API's list, filter, update and delete behaviour it replaces.

setupTestEnv();
const { db } = setupTestDb();

beforeEach(async () => {
  await runMigrations(db());
});

afterEach(() => resetClock());

const START = new Date("2026-09-20T09:00:00Z");

function at(minutes: number): Date {
  return new Date(START.getTime() + minutes * 60_000);
}

async function seed() {
  const add = (minutes: number, input: Parameters<typeof inquiryInput>[0]) =>
    insertInquiry(db(), inquiryInput(input), { source: "form", receivedAt: at(minutes) });
  return {
    call: await add(0, {
      kind: "call",
      name: "Ada Lovelace",
      email: "ada@example.com",
      subject: "Kickoff call",
      call: { timeZone: "Europe/Istanbul", date: "2026-10-01", time: "14:30", duration: 45 },
    }),
    revision: await add(1, {
      kind: "revision",
      name: "Grace Hopper",
      email: "grace@example.com",
      projectReference: "Shop (v2.0)",
    }),
    question: await add(2, { kind: "question", name: "Alan Turing", email: "ALAN@example.com" }),
    second: await add(3, {
      kind: "question",
      name: "Barbara Liskov",
      email: "barbara@example.org",
      subject: "Loader app",
    }),
  };
}

const query = (overrides: Partial<InboxQuery> = {}): InboxQuery => ({
  view: "all",
  kind: null,
  q: null,
  page: 1,
  limit: 25,
  ...overrides,
});

const ids = (items: { _id: ObjectId }[]) => items.map((item) => item._id.toHexString());

describe("the inbox list", () => {
  it("shows the newest first, with counts per status", async () => {
    const seeded = await seed();
    const { items, total, counts } = await listInquiries(db(), query(), at(10));
    expect(total).toBe(4);
    expect(ids(items)).toEqual(ids([seeded.second, seeded.question, seeded.revision, seeded.call]));
    expect(counts).toMatchObject({
      inbox: 4,
      new: 4,
      open: 0,
      confirmed: 0,
      done: 0,
      declined: 0,
      spam: 0,
      all: 4,
    });
    expect(items[0]).toMatchObject({
      ref: "INQ-2026-0004",
      replyCount: 0,
      snippet: "How much would a moderation bot cost?",
    });
  });

  it("filters by status and kind, searches safely, and pages", async () => {
    const seeded = await seed();
    await changeStatus(db(), seeded.revision._id, "confirmed", at(5));
    await changeStatus(db(), seeded.question._id, "declined", at(5));
    const list = (overrides: Partial<InboxQuery>) => listInquiries(db(), query(overrides), at(10));

    const confirmed = await list({ view: "confirmed" });
    expect(ids(confirmed.items)).toEqual(ids([seeded.revision]));
    expect(confirmed.counts).toMatchObject({ new: 2, confirmed: 1, declined: 1, done: 0, inbox: 3 });

    const questions = await list({ kind: "question" });
    expect(ids(questions.items).sort()).toEqual(ids([seeded.question, seeded.second]).sort());
    expect(questions.counts).toMatchObject({ new: 1, declined: 1, confirmed: 0 });

    expect(ids((await list({ q: "alan@EXAMPLE" })).items)).toEqual(ids([seeded.question]));
    expect(ids((await list({ q: "kickoff" })).items)).toEqual(ids([seeded.call]));
    expect(ids((await list({ q: "(v2.0)" })).items)).toEqual(ids([seeded.revision]));
    expect(ids((await list({ q: "INQ-2026-0001" })).items)).toEqual(ids([seeded.call]));
    expect((await list({ q: "v2x0" })).total).toBe(0);
    expect((await list({ q: ".*" })).total).toBe(0);
    expect((await list({ q: "liskov", view: "new" })).total).toBe(1);

    const pageOne = await list({ limit: 3, page: 1 });
    const pageTwo = await list({ limit: 3, page: 2 });
    expect([pageOne.items.length, pageTwo.items.length]).toEqual([3, 1]);
    expect(ids(pageTwo.items)).toEqual(ids([seeded.call]));
    expect((await list({ limit: 3, page: 5 })).items).toEqual([]);
  });

  it("keeps spam out of the inbox and out of All", async () => {
    const seeded = await seed();
    await changeStatus(db(), seeded.second._id, "spam", at(5));
    const { counts, items } = await listInquiries(db(), query({ view: "all" }), at(10));
    expect(counts).toMatchObject({ all: 3, inbox: 3, spam: 1 });
    expect(ids(items)).not.toContain(seeded.second._id.toHexString());
  });

  it("hides snoozed messages until their time comes", async () => {
    const seeded = await seed();
    await snooze(db(), seeded.call._id, at(60));
    const before = await listInquiries(db(), query({ view: "inbox" }), at(30));
    expect(ids(before.items)).not.toContain(seeded.call._id.toHexString());
    expect(before.counts).toMatchObject({ inbox: 3, snoozed: 1 });
    expect(ids((await listInquiries(db(), query({ view: "snoozed" }), at(30))).items)).toEqual(
      ids([seeded.call]),
    );
    const after = await listInquiries(db(), query({ view: "inbox" }), at(61));
    expect(after.counts).toMatchObject({ inbox: 4, snoozed: 0 });
  });
});

describe("changing a message", () => {
  it("records status changes once, with the previous status", async () => {
    const { call } = await seed();
    const confirmed = await changeStatus(db(), call._id, "confirmed", at(5));
    expect(confirmed?.history).toEqual([{ at: at(5), status: "confirmed", from: "new" }]);
    expect(confirmed?.updatedAt).toEqual(at(5));
    const same = await changeStatus(db(), call._id, "confirmed", at(6));
    expect(same?.history).toHaveLength(1);
    expect(same?.updatedAt).toEqual(at(5));
    const done = await changeStatus(db(), call._id, "done", at(7));
    expect(done?.history.map((entry) => [entry.from, entry.status])).toEqual([
      ["new", "confirmed"],
      ["confirmed", "done"],
    ]);
    expect(await changeStatus(db(), new ObjectId(), "done")).toBeNull();
  });

  it("keeps a message for 24 months after the last activity, and spam for 30 days", async () => {
    const { question } = await seed();
    expect(question.purgeAt).toEqual(new Date(at(2).getTime() + RETENTION_MS));
    const spam = await changeStatus(db(), question._id, "spam", at(10));
    expect(spam?.purgeAt).toEqual(new Date(at(10).getTime() + SPAM_RETENTION_MS));
    const back = await changeStatus(db(), question._id, "open", at(20));
    expect(back?.purgeAt).toEqual(new Date(at(20).getTime() + RETENTION_MS));
    const indexes = await db().collection("inquiries").indexes();
    expect(indexes.find((index) => index.key.purgeAt === 1)?.expireAfterSeconds).toBe(0);
  });

  it("schedules calls only, and can clear the time of anything", async () => {
    const { call, question } = await seed();
    const scheduled = await setSchedule(db(), call._id, new Date("2026-10-01T11:30:00Z"));
    expect(scheduled?.scheduledAt).toEqual(new Date("2026-10-01T11:30:00Z"));
    await expect(setSchedule(db(), question._id, new Date())).rejects.toBeInstanceOf(NotACallError);
    expect((await setSchedule(db(), question._id, null))?.scheduledAt).toBeNull();
    expect(await setSchedule(db(), new ObjectId(), null)).toBeNull();
  });

  it("saves notes, labels and replies", async () => {
    const { question } = await seed();
    expect((await setNote(db(), question._id, "Bring the brand guide."))?.note).toBe(
      "Bring the brand guide.",
    );
    await setLabels(db(), question._id, ["urgent", "returning client"]);
    expect(await listLabels(db())).toEqual(["returning client", "urgent"]);
    setClock(() => at(30));
    const reply = await addReply(db(), question._id, {
      id: new ObjectId().toHexString(),
      kind: "reply",
      to: question.email,
      subject: "Re: pricing",
      body: "About $480.",
      createdAt: at(30),
      delivery: "queued",
      sentAt: null,
      error: null,
    });
    expect(reply?.replies).toHaveLength(1);
    expect(reply?.lastActivityAt).toEqual(at(30));
    const listed = await listInquiries(db(), query({ q: "Alan" }), at(31));
    expect(listed.items[0]?.replyCount).toBe(1);
  });

  it("deletes a message once", async () => {
    const { question } = await seed();
    expect(await deleteInquiry(db(), question._id)).toBe(true);
    expect(await getInquiry(db(), question._id)).toBeNull();
    expect(await deleteInquiry(db(), question._id)).toBe(false);
  });

  it("numbers messages per year of receipt", async () => {
    await insertInquiry(db(), inquiryInput(), {
      source: "form",
      receivedAt: new Date("2026-12-31T23:59:00Z"),
    });
    const next = await insertInquiry(db(), inquiryInput(), {
      source: "form",
      receivedAt: new Date("2027-01-01T00:01:00Z"),
    });
    expect(next.ref).toBe("INQ-2027-0001");
  });

  it("reads only well-formed ids", () => {
    expect(parseInquiryId("66f4a1b2c3d4e5f6a7b8c9d0")?.toHexString()).toBe("66f4a1b2c3d4e5f6a7b8c9d0");
    for (const bad of ["does-not-exist", "66F4A1B2C3D4E5F6A7B8C9D0", "66f4a1b2c3d4e5f6a7b8c9d", "{$ne:1}"]) {
      expect(parseInquiryId(bad)).toBeNull();
    }
  });
});
