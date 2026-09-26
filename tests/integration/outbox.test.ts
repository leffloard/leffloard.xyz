import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetClock, setClock } from "@/server/clock";
import { runMigrations } from "@/server/db/migrate";
import { addReply, insertInquiry } from "@/server/inquiries/store";
import type { InquiryDoc } from "@/server/inquiries/types";
import type { Channels } from "@/server/notify/channels";
import { DeliveryError, postDiscord } from "@/server/notify/discord";
import {
  drainOutbox,
  enqueue,
  MAX_ATTEMPTS,
  outbox,
  outboxSummary,
  retryFailed,
  type Senders,
} from "@/server/notify/outbox";
import type { EmailMessage } from "@/server/notify/templates";
import { inquiryInput } from "../helpers/inquiry";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

setupTestEnv();
const { db } = setupTestDb();

beforeEach(async () => {
  await runMigrations(db());
});

afterEach(() => resetClock());

const WEBHOOK = "https://discord.test/api/webhooks/42/SECRET-WEBHOOK-TOKEN";
const CHANNELS: Channels = {
  email: { delivery: "log", from: "noreply@leffloard.test" },
  ownerEmail: "owner@leffloard.test",
  discordWebhookUrl: WEBHOOK,
};

const email = (subject = "Hello"): EmailMessage => ({
  to: [{ address: "x@example.com" }],
  subject,
  text: "Hi\n",
});

function recordingSenders(overrides: Partial<Senders> = {}) {
  const emails: EmailMessage[] = [];
  const posts: unknown[] = [];
  const senders: Senders = {
    channels: () => CHANNELS,
    sendEmail: async (message) => {
      emails.push(message);
    },
    postDiscord: async (_url, payload) => {
      posts.push(payload);
    },
    ...overrides,
  };
  return { senders, emails, posts };
}

let clock = new Date("2026-09-26T10:00:00Z");
function advance(ms: number): void {
  clock = new Date(clock.getTime() + ms);
}

beforeEach(() => {
  clock = new Date("2026-09-26T10:00:00Z");
  setClock(() => clock);
});

describe("the outbox", () => {
  it("queues each event once", async () => {
    expect(
      await enqueue(db(), { channel: "email", payload: email(), dedupeKey: "event-1", label: "Test" }),
    ).toBeInstanceOf(ObjectId);
    expect(
      await enqueue(db(), { channel: "email", payload: email(), dedupeKey: "event-1", label: "Test" }),
    ).toBeNull();
    expect(await outbox(db()).countDocuments()).toBe(1);
  });

  it("sends emails and Discord messages, and records it", async () => {
    await enqueue(db(), { channel: "email", payload: email("First"), dedupeKey: "a", label: "A" });
    await enqueue(db(), {
      channel: "discord",
      payload: { embeds: [], allowed_mentions: { parse: [] } },
      dedupeKey: "b",
      label: "B",
    });
    const { senders, emails, posts } = recordingSenders();
    expect(await drainOutbox(db(), { senders })).toEqual({ sent: 2, skipped: 0, retrying: 0, failed: 0 });
    expect(emails.map((message) => message.subject)).toEqual(["First"]);
    expect(posts).toHaveLength(1);
    const items = await outbox(db()).find().toArray();
    expect(items.map((item) => [item.status, item.attempts, item.sentAt?.toISOString()])).toEqual([
      ["sent", 1, clock.toISOString()],
      ["sent", 1, clock.toISOString()],
    ]);
    expect(await drainOutbox(db(), { senders })).toEqual({ sent: 0, skipped: 0, retrying: 0, failed: 0 });
  });

  it("skips a channel that is no longer configured", async () => {
    await enqueue(db(), {
      channel: "discord",
      payload: { embeds: [], allowed_mentions: { parse: [] } },
      dedupeKey: "d",
      label: "D",
    });
    const { senders } = recordingSenders({ channels: () => ({ ...CHANNELS, discordWebhookUrl: null }) });
    expect(await drainOutbox(db(), { senders })).toMatchObject({ skipped: 1 });
    expect(await outbox(db()).findOne()).toMatchObject({
      status: "skipped",
      lastError: "The channel is not configured.",
    });
  });

  it("retries a failure with growing delays, then gives up", async () => {
    await enqueue(db(), { channel: "email", payload: email(), dedupeKey: "flaky", label: "Flaky" });
    const { senders } = recordingSenders({
      sendEmail: async () => {
        throw Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" });
      },
    });
    expect(await drainOutbox(db(), { senders })).toMatchObject({ retrying: 1 });
    let item = await outbox(db()).findOne();
    expect(item).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "ETIMEDOUT: Connection timeout",
    });
    expect(item?.nextAttemptAt.getTime()).toBe(clock.getTime() + 60_000);

    // Not due yet.
    expect(await drainOutbox(db(), { senders })).toMatchObject({ retrying: 0 });
    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt++) {
      advance(24 * 3600_000);
      await drainOutbox(db(), { senders });
    }
    item = await outbox(db()).findOne();
    expect(item).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    expect(await outboxSummary(db())).toEqual({ pending: 0, failed: 1, sentLastDay: 0 });

    expect(await retryFailed(db())).toBe(1);
    const working = recordingSenders();
    expect(await drainOutbox(db(), { senders: working.senders })).toMatchObject({ sent: 1 });
  });

  it("never stores or reports the webhook address", async () => {
    await enqueue(db(), {
      channel: "discord",
      payload: { embeds: [], allowed_mentions: { parse: [] } },
      dedupeKey: "w",
      label: "W",
    });
    const answers = [new Response('{"message": "Unknown Webhook"}', { status: 404 })];
    const fakeFetch = (async () => answers.shift()!) as unknown as typeof fetch;
    const { senders } = recordingSenders({
      postDiscord: (url, payload) => postDiscord(url, payload, fakeFetch),
    });
    await drainOutbox(db(), { senders });
    const item = await outbox(db()).findOne();
    expect(item?.lastError).toBe('Discord answered HTTP 404: {"message": "Unknown Webhook"}');
    expect(JSON.stringify(item)).not.toContain("SECRET-WEBHOOK-TOKEN");
    expect(new DeliveryError("x").name).toBe("DeliveryError");
  });

  it("sends each message once when two senders run at the same time", async () => {
    for (let index = 0; index < 12; index++) {
      await enqueue(db(), {
        channel: "email",
        payload: email(`Message ${index}`),
        dedupeKey: `m${index}`,
        label: "M",
      });
    }
    const subjects: string[] = [];
    const slow = recordingSenders({
      sendEmail: async (message) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        subjects.push(message.subject);
      },
    });
    await Promise.all([
      drainOutbox(db(), { senders: slow.senders }),
      drainOutbox(db(), { senders: slow.senders }),
    ]);
    expect(subjects.sort()).toEqual(Array.from({ length: 12 }, (_, index) => `Message ${index}`).sort());
  });

  it("takes over a message whose sender died mid-send", async () => {
    await enqueue(db(), { channel: "email", payload: email(), dedupeKey: "stuck", label: "Stuck" });
    await outbox(db()).updateOne(
      {},
      { $set: { status: "sending", lockedUntil: new Date(clock.getTime() + 60_000) } },
    );
    const { senders, emails } = recordingSenders();
    expect(await drainOutbox(db(), { senders })).toMatchObject({ sent: 0 });
    advance(2 * 60_000);
    expect(await drainOutbox(db(), { senders })).toMatchObject({ sent: 1 });
    expect(emails).toHaveLength(1);
  });

  it("keeps the inbox's delivery status of a reply up to date", async () => {
    const inquiry: InquiryDoc = await insertInquiry(db(), inquiryInput(), { source: "form" });
    const replyId = new ObjectId().toHexString();
    await addReply(db(), inquiry._id, {
      id: replyId,
      kind: "reply",
      to: inquiry.email,
      subject: "Re: pricing",
      body: "About $480.",
      createdAt: clock,
      delivery: "queued",
      sentAt: null,
      error: null,
    });
    await enqueue(db(), {
      channel: "email",
      payload: email(),
      dedupeKey: `reply:${replyId}`,
      label: "Reply",
      ref: { inquiryId: inquiry._id, replyId },
    });
    const failing = recordingSenders({
      sendEmail: async () => {
        throw new Error("Invalid login: 535 Username and Password not accepted");
      },
    });
    await drainOutbox(db(), { senders: failing.senders });
    let stored = await db().collection<InquiryDoc>("inquiries").findOne({ _id: inquiry._id });
    expect(stored?.replies[0]).toMatchObject({
      delivery: "queued",
      error: "Invalid login: 535 Username and Password not accepted",
    });
    advance(2 * 60_000);
    await drainOutbox(db(), { senders: recordingSenders().senders });
    stored = await db().collection<InquiryDoc>("inquiries").findOne({ _id: inquiry._id });
    expect(stored?.replies[0]).toMatchObject({ delivery: "sent", error: null, sentAt: clock });
  });
});
