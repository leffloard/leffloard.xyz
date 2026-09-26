import "server-only";
import { MongoServerError, ObjectId, type Db } from "mongodb";
import { now } from "@/server/clock";
import type { Delivery } from "@/server/inquiries/types";
import { log } from "@/server/log";
import { readChannels, type Channels } from "@/server/notify/channels";
import { postDiscord, type DiscordPoster } from "@/server/notify/discord";
import { sendEmail, type MailSender } from "@/server/notify/email";
import type { DiscordPayload, EmailMessage } from "@/server/notify/templates";

// Every email and Discord message leaves through this outbox. The message is stored first (rendered, so a
// retry sends exactly the same text) and sent right after the response, or by the scheduler within a
// minute. A failed send is retried with growing delays; dedupeKey makes enqueueing the same event twice
// harmless. Delivery is at least once: a crash between sending and recording can repeat a message.

export type OutboxItem =
  { channel: "email"; payload: EmailMessage } | { channel: "discord"; payload: DiscordPayload };

export type OutboxStatus = "pending" | "sending" | "sent" | "failed" | "skipped";

export type OutboxRef = { inquiryId: ObjectId; replyId?: string };

export type OutboxDoc = OutboxItem & {
  _id: ObjectId;
  dedupeKey: string;
  label: string; // for the admin: "Alert for INQ-2026-0007"
  ref: OutboxRef | null;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: Date;
  lockedUntil: Date | null;
  lastError: string | null;
  createdAt: Date;
  sentAt: Date | null;
  purgeAt: Date; // messages contain personal data: kept 30 days for the delivery log
};

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 12 * 3600_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const CLAIM_MS = 2 * 60_000;
const KEEP_MS = 30 * 24 * 3600_000;
const DUPLICATE_KEY = 11000;

export function outbox(db: Db) {
  return db.collection<OutboxDoc>("outbox");
}

export type EnqueueInput = OutboxItem & { dedupeKey: string; label: string; ref?: OutboxRef };

// Returns the new item's id, or null when an item with the same dedupeKey exists.
export async function enqueue(db: Db, input: EnqueueInput): Promise<ObjectId | null> {
  const at = now();
  const doc = {
    _id: new ObjectId(),
    ...input,
    ref: input.ref ?? null,
    status: "pending",
    attempts: 0,
    nextAttemptAt: at,
    lockedUntil: null,
    lastError: null,
    createdAt: at,
    sentAt: null,
    purgeAt: new Date(at.getTime() + KEEP_MS),
  } as OutboxDoc;
  try {
    await outbox(db).insertOne(doc);
    return doc._id;
  } catch (error) {
    if (error instanceof MongoServerError && error.code === DUPLICATE_KEY) return null;
    throw error;
  }
}

export type Senders = { channels: () => Channels; sendEmail: MailSender; postDiscord: DiscordPoster };

const defaultSenders: Senders = {
  channels: () => readChannels(),
  sendEmail,
  postDiscord: (url, payload) => postDiscord(url, payload),
};

function errorMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return (typeof code === "string" && !message.includes(code) ? `${code}: ${message}` : message).slice(
    0,
    300,
  );
}

async function syncReply(
  db: Db,
  item: OutboxDoc,
  update: { delivery: Delivery; sentAt?: Date | null; error: string | null },
): Promise<void> {
  if (!item.ref?.replyId) return;
  const set: Record<string, unknown> = {
    "replies.$[reply].delivery": update.delivery,
    "replies.$[reply].error": update.error,
  };
  if (update.sentAt !== undefined) set["replies.$[reply].sentAt"] = update.sentAt;
  await db
    .collection("inquiries")
    .updateOne(
      { _id: item.ref.inquiryId },
      { $set: set },
      { arrayFilters: [{ "reply.id": item.ref.replyId }] },
    );
}

async function claim(db: Db, at: Date): Promise<OutboxDoc | null> {
  return outbox(db).findOneAndUpdate(
    {
      $or: [
        { status: "pending", nextAttemptAt: { $lte: at } },
        // A sender that died mid-send leaves its claim behind; it expires.
        { status: "sending", lockedUntil: { $lt: at } },
      ],
    },
    { $set: { status: "sending", lockedUntil: new Date(at.getTime() + CLAIM_MS) }, $inc: { attempts: 1 } },
    { sort: { nextAttemptAt: 1 }, returnDocument: "after" },
  );
}

async function deliver(item: OutboxDoc, senders: Senders): Promise<"sent" | "skipped"> {
  const channels = senders.channels();
  if (item.channel === "email") {
    if (!channels.email) return "skipped";
    await senders.sendEmail(item.payload, channels.email);
  } else {
    if (!channels.discordWebhookUrl) return "skipped";
    await senders.postDiscord(channels.discordWebhookUrl, item.payload);
  }
  return "sent";
}

export type DrainSummary = { sent: number; skipped: number; retrying: number; failed: number };

export async function drainOutbox(
  db: Db,
  { senders = defaultSenders, limit = 25 }: { senders?: Senders; limit?: number } = {},
): Promise<DrainSummary> {
  const summary: DrainSummary = { sent: 0, skipped: 0, retrying: 0, failed: 0 };
  for (let count = 0; count < limit; count++) {
    const item = await claim(db, now());
    if (!item) break;
    const mine = { _id: item._id, status: "sending" as const };
    try {
      const result = await deliver(item, senders);
      if (result === "sent") {
        const sentAt = now();
        await outbox(db).updateOne(mine, {
          $set: { status: "sent", sentAt, lockedUntil: null, lastError: null },
        });
        await syncReply(db, item, { delivery: "sent", sentAt, error: null });
        summary.sent++;
      } else {
        const lastError = "The channel is not configured.";
        await outbox(db).updateOne(mine, { $set: { status: "skipped", lockedUntil: null, lastError } });
        await syncReply(db, item, { delivery: "skipped", error: lastError });
        summary.skipped++;
      }
    } catch (error) {
      const lastError = errorMessage(error);
      const context = {
        outboxId: item._id.toHexString(),
        channel: item.channel,
        attempts: item.attempts,
        error: lastError,
      };
      if (item.attempts >= MAX_ATTEMPTS) {
        await outbox(db).updateOne(mine, { $set: { status: "failed", lockedUntil: null, lastError } });
        await syncReply(db, item, { delivery: "failed", error: lastError });
        log.error(context, "notification failed for good");
        summary.failed++;
      } else {
        const delay = RETRY_DELAYS_MS[item.attempts - 1] ?? RETRY_DELAYS_MS.at(-1)!;
        await outbox(db).updateOne(mine, {
          $set: {
            status: "pending",
            lockedUntil: null,
            lastError,
            nextAttemptAt: new Date(now().getTime() + delay),
          },
        });
        await syncReply(db, item, { delivery: "queued", error: lastError });
        log.warn(context, "notification failed; retrying later");
        summary.retrying++;
      }
    }
  }
  return summary;
}

export type OutboxSummary = { pending: number; failed: number; sentLastDay: number };

export async function outboxSummary(db: Db): Promise<OutboxSummary> {
  const since = new Date(now().getTime() - 24 * 3600_000);
  const [pending, failed, sentLastDay] = await Promise.all([
    outbox(db).countDocuments({ status: { $in: ["pending", "sending"] } }),
    outbox(db).countDocuments({ status: "failed" }),
    outbox(db).countDocuments({ status: "sent", sentAt: { $gte: since } }),
  ]);
  return { pending, failed, sentLastDay };
}

export type OutboxRow = Pick<
  OutboxDoc,
  "_id" | "channel" | "label" | "status" | "attempts" | "createdAt" | "sentAt" | "lastError" | "nextAttemptAt"
>;

export async function recentOutbox(db: Db, limit = 20): Promise<OutboxRow[]> {
  return outbox(db)
    .find(
      {},
      {
        projection: {
          channel: 1,
          label: 1,
          status: 1,
          attempts: 1,
          createdAt: 1,
          sentAt: 1,
          lastError: 1,
          nextAttemptAt: 1,
        },
      },
    )
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray() as Promise<OutboxRow[]>;
}

// Puts failed messages back in the queue, e.g. after fixing the SMTP password.
export async function retryFailed(db: Db): Promise<number> {
  const result = await outbox(db).updateMany(
    { status: "failed" },
    { $set: { status: "pending", attempts: 0, nextAttemptAt: now(), lastError: null } },
  );
  return result.modifiedCount;
}
