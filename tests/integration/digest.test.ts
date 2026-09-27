import { ObjectId } from "mongodb";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyticsEvents } from "@/server/analytics/collections";
import { resetClock, setClock } from "@/server/clock";
import { closeClient } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { submitInquiry } from "@/server/inquiries/intake";
import type { Channels } from "@/server/notify/channels";
import { buildDigest, queueDigest, runDigestJob } from "@/server/notify/digest";
import { outbox } from "@/server/notify/outbox";
import { getNotificationSettings, saveNotificationSettings } from "@/server/notify/settings";
import { createTask } from "@/server/tasks/store";
import { inquiryInput, SITE_URL } from "../helpers/inquiry";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

const { db, url, name } = setupTestDb();
setupTestEnv({ MONGO_URL: url, DB_NAME: name });

// 07:40 in Istanbul on Monday 28 September 2026.
const MORNING = new Date("2026-09-28T04:40:00Z");
const CHANNELS: Channels = {
  email: { delivery: "log", from: "site@leffloard.test" },
  ownerEmail: "owner@leffloard.test",
  discordWebhookUrl: null,
};
const NO_ALERTS: Channels = { email: null, ownerEmail: null, discordWebhookUrl: null };

beforeEach(async () => {
  await runMigrations(db());
  setClock(() => MORNING);
});

afterEach(() => resetClock());

afterAll(async () => {
  await closeClient();
});

async function digestOn(time = "07:30") {
  const { version, ...current } = await getNotificationSettings(db());
  await saveNotificationSettings(db(), { ...current, digestEnabled: true, digestTime: time }, version);
}

async function busyDay() {
  // A call at 10:00 today, and one tomorrow.
  for (const [startsAt, title] of [
    [new Date("2026-09-28T07:00:00Z"), "Intro call"],
    [new Date("2026-09-29T07:00:00Z"), "Tomorrow's call"],
  ] as const) {
    await db()
      .collection("meetings")
      .insertOne({
        _id: new ObjectId(),
        status: "confirmed",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60_000),
        title,
        name: "Ada Lovelace",
        manageTokenHash: `hash-${title}`,
      });
  }
  await createTask(db(), { title: "Send the invoice", due: "2026-09-28" });
  await createTask(db(), { title: "Fix the login bug", due: "2026-09-25" });
  await createTask(db(), { title: "Plan the launch", due: "2026-10-05" });
  await submitInquiry(db(), inquiryInput({ name: "Alan Turing", subject: "Discord bot pricing" }), {
    source: "form",
    siteUrl: SITE_URL,
    channels: NO_ALERTS,
  });
  await db()
    .collection("invoices")
    .insertOne(
      {
        _id: new ObjectId(),
        status: "issued",
        kind: "invoice",
        dueDate: "2026-09-20",
        currency: "USD",
        totals: { totalMinor: 60_000 },
        paidMinor: 10_000,
      },
      // Only what the digest reads; the billing tests cover real invoices.
      { bypassDocumentValidation: true },
    );
  // Yesterday, in Istanbul: two visitors, one of whom sent a message.
  const event = (visitor: string, type: "view" | "goal") => ({
    _id: new ObjectId(),
    type,
    at: new Date("2026-09-27T10:00:00Z"),
    day: "2026-09-27",
    visitor,
    path: type === "view" ? "/" : null,
    entry: false,
    source: null,
    campaign: null,
    country: null,
    device: null,
    notFound: false,
    goal: type === "goal" ? ("inquiry" as const) : null,
  });
  await analyticsEvents(db()).insertMany([
    event("a", "view"),
    event("a", "view"),
    event("b", "view"),
    event("a", "goal"),
  ]);
}

describe("the daily digest", () => {
  it("sums up the day", async () => {
    await busyDay();
    const digest = await buildDigest(db(), { at: MORNING, siteUrl: SITE_URL });
    expect(digest.subject).toBe("Your day: 1 call, 2 tasks, 1 new message, 1 overdue invoice");
    expect(digest.quiet).toBe(false);
    expect(digest.text).toContain("Your day, Monday 28 September");
    expect(digest.text).toContain("Calls today (1)\n  10:00  Intro call with Ada Lovelace");
    expect(digest.text).not.toContain("Tomorrow's call");
    expect(digest.text).toContain("Tasks due today or late (2)");
    expect(digest.text).toContain("  [late since 25 Sep] Fix the login bug");
    expect(digest.text).toContain("  Send the invoice");
    expect(digest.text).not.toContain("Plan the launch");
    expect(digest.text).toContain("New messages (1)\n  Alan Turing: Discord bot pricing");
    expect(digest.text).toContain("1 overdue invoice: $500 to collect");
    expect(digest.text).toContain("Yesterday on the site: 2 visitors, 3 page views; 1 × sent a message.");
    expect(digest.text).toContain(`Change or stop this email: ${SITE_URL}/admin/notifications`);
  });

  it("says when there's nothing waiting", async () => {
    const digest = await buildDigest(db(), { at: MORNING, siteUrl: SITE_URL });
    expect(digest.subject).toBe("Your day: nothing waiting");
    expect(digest.quiet).toBe(true);
    expect(digest.text).toContain("No calls today.");
  });

  it("goes out once a day, from the time set, only when it is on and email works", async () => {
    expect(await runDigestJob(db(), { siteUrl: SITE_URL, channels: CHANNELS }, MORNING)).toBeNull();
    await digestOn("08:00");
    expect(await runDigestJob(db(), { siteUrl: SITE_URL, channels: CHANNELS }, MORNING)).toBeNull();
    await digestOn("07:30");
    expect(await runDigestJob(db(), { siteUrl: SITE_URL, channels: NO_ALERTS }, MORNING)).toBeNull();

    const first = await runDigestJob(db(), { siteUrl: SITE_URL, channels: CHANNELS }, MORNING);
    expect(first).toEqual({ ran: true, ok: true, message: "queued" });
    const later = new Date(MORNING.getTime() + 15 * 60_000);
    expect(await runDigestJob(db(), { siteUrl: SITE_URL, channels: CHANNELS }, later)).toEqual({
      ran: false,
      reason: "done",
    });
    const sent = await outbox(db()).find().toArray();
    expect(sent.map((item) => [item.channel, item.dedupeKey, item.label])).toEqual([
      ["email", "digest:2026-09-28", "Daily digest, 2026-09-28"],
    ]);
    expect(sent[0]?.payload).toMatchObject({ to: [{ address: "owner@leffloard.test" }] });

    // "Send it now" uses its own key.
    const now = await queueDigest(
      db(),
      { siteUrl: SITE_URL, channels: CHANNELS },
      {
        at: later,
        key: "digest:2026-09-28:now:1",
      },
    );
    expect(now.queued).toBe(true);
    expect(await outbox(db()).countDocuments()).toBe(2);
  });
});
