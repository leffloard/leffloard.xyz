import "server-only";
import { MongoServerError, ObjectId, type Db } from "mongodb";
import { quietUntil, type AlertKind } from "@/lib/notifications/model";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { now } from "@/server/clock";
import type { Channels } from "@/server/notify/channels";
import { enqueue, type OutboxRef } from "@/server/notify/outbox";
import { getNotificationSettings } from "@/server/notify/settings";
import type { DiscordPayload, EmailMessage } from "@/server/notify/templates";

// Every alert for the owner goes through here: it shows in the admin's notification centre, and goes by
// email and to Discord as the notification settings route its kind, held during quiet hours until they end.

export type NotificationDoc = {
  _id: ObjectId;
  key: string; // one notification per event
  kind: AlertKind;
  title: string;
  body: string | null;
  href: string | null; // an admin page
  createdAt: Date;
  readAt: Date | null;
  purgeAt: Date;
};

const KEEP_MS = 90 * 24 * 3600_000;
const DUPLICATE_KEY = 11000;

export function notifications(db: Db) {
  return db.collection<NotificationDoc>("notifications");
}

export type OwnerAlert = {
  kind: AlertKind;
  key: string; // the event: "inquiry:<id>"; the outbox items add ":email" and ":discord"
  label: string; // the outbox's name for the messages
  title: string; // the notification centre's
  body?: string | null;
  href?: string | null;
  ref?: OutboxRef;
  email?: (to: string) => EmailMessage;
  discord?: () => DiscordPayload;
};

export async function alertOwner(
  db: Db,
  channels: Channels,
  alert: OwnerAlert,
  at: Date = now(),
): Promise<void> {
  try {
    await notifications(db).updateOne(
      { key: alert.key },
      {
        $setOnInsert: {
          _id: new ObjectId(),
          kind: alert.kind,
          title: alert.title.slice(0, 200),
          body: alert.body ? alert.body.slice(0, 500) : null,
          href: alert.href ?? null,
          createdAt: at,
          readAt: null,
          purgeAt: new Date(at.getTime() + KEEP_MS),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    // The same event recorded by two requests at once: one notification is enough.
    if (!(error instanceof MongoServerError && error.code === DUPLICATE_KEY)) throw error;
  }

  const settings = await getNotificationSettings(db);
  const route = settings.routes[alert.kind];
  const notBefore = settings.quietEnabled ? quietUntil(settings.quietRanges, at, ADMIN_TIME_ZONE) : null;
  // quietHours: the outbox checks again before each attempt, so a retry doesn't go out during them either.
  if (route.discord && channels.discordWebhookUrl && alert.discord) {
    await enqueue(db, {
      channel: "discord",
      payload: alert.discord(),
      dedupeKey: `${alert.key}:discord`,
      label: alert.label,
      ref: alert.ref,
      notBefore,
      quietHours: true,
    });
  }
  if (route.email && channels.ownerEmail && alert.email) {
    await enqueue(db, {
      channel: "email",
      payload: alert.email(channels.ownerEmail),
      dedupeKey: `${alert.key}:email`,
      label: alert.label,
      ref: alert.ref,
      notBefore,
      quietHours: true,
    });
  }
}

// --- The notification centre --------------------------------------------------------------------------------

export async function countUnread(db: Db): Promise<number> {
  return notifications(db).countDocuments({ readAt: null }, { limit: 100 });
}

export async function listNotifications(
  db: Db,
  { unreadOnly = false, limit = 50 }: { unreadOnly?: boolean; limit?: number } = {},
): Promise<NotificationDoc[]> {
  return notifications(db)
    .find(unreadOnly ? { readAt: null } : {})
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .toArray();
}

// Marks some notifications, or all of them, as read; returns how many changed.
export async function markRead(db: Db, ids: ObjectId[] | "all", at: Date = now()): Promise<number> {
  const filter = ids === "all" ? { readAt: null } : { _id: { $in: ids }, readAt: null };
  const result = await notifications(db).updateMany(filter, { $set: { readAt: at } });
  return result.modifiedCount;
}

export async function markUnread(db: Db, id: ObjectId): Promise<boolean> {
  const result = await notifications(db).updateOne({ _id: id }, { $set: { readAt: null } });
  return result.matchedCount === 1;
}
