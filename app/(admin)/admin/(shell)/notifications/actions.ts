"use server";

import { ObjectId } from "mongodb";
import { refresh } from "next/cache";
import { z } from "zod";
import { fail, ok } from "@/lib/action-result";
import { ADMIN_TIME_ZONE, plural } from "@/lib/format";
import { todayIn } from "@/lib/intake/time";
import { ALERT_KINDS, describeRange, notificationSettingsForm } from "@/lib/notifications/model";
import { adminAction } from "@/server/auth/action";
import { audit } from "@/server/auth/audit";
import { now } from "@/server/clock";
import { getEnv } from "@/server/env";
import { readChannels } from "@/server/notify/channels";
import { buildDigest, queueDigest } from "@/server/notify/digest";
import { sendQueuedSoon } from "@/server/notify/kick";
import { markRead, markUnread, notifications } from "@/server/notify/owner";
import { saveNotificationSettings } from "@/server/notify/settings";

const objectId = z.string().regex(/^[a-f0-9]{24}$/, "Unknown notification.");

// Marks the given notifications as read, or every unread one when none are given.
export const markNotificationsReadAction = adminAction(
  z.object({ ids: z.array(objectId).max(200).optional() }).strict(),
  async ({ ids }, { db }) => {
    const changed = await markRead(db, ids?.length ? ids.map((id) => new ObjectId(id)) : "all");
    refresh();
    return ok(
      { changed },
      ids?.length
        ? undefined
        : changed
          ? `${plural(changed, "notification")} marked as read.`
          : "Nothing unread.",
    );
  },
);

export const markNotificationUnreadAction = adminAction(
  z.object({ id: objectId }).strict(),
  async ({ id }, { db }) => {
    if (!(await markUnread(db, new ObjectId(id)))) return fail("That notification is gone.");
    refresh();
    return ok(null);
  },
);

// Opening a notification marks it read and says where to go.
export const openNotificationAction = adminAction(
  z.object({ id: objectId }).strict(),
  async ({ id }, { db }) => {
    const doc = await notifications(db).findOne({ _id: new ObjectId(id) }, { projection: { href: 1 } });
    if (!doc) return fail("That notification is gone.");
    await markRead(db, [doc._id]);
    // The bell's count is in the admin layout, which a client-side move to the next page keeps.
    refresh();
    return ok({ href: doc.href });
  },
);

export const saveNotificationSettingsAction = adminAction(
  notificationSettingsForm,
  async ({ version, ...input }, { db, user, client }) => {
    const saved = await saveNotificationSettings(db, input, version);
    if (!saved.ok) return fail("The settings were changed in another tab. Reload to see them.");
    await audit(db, {
      action: "notifications.settings.changed",
      actorId: user._id,
      ip: client.ip,
      userAgent: client.userAgent,
      details: {
        email: ALERT_KINDS.filter((kind) => input.routes[kind].email).join(", ") || "none",
        discord: ALERT_KINDS.filter((kind) => input.routes[kind].discord).join(", ") || "none",
        quietHours: input.quietEnabled ? input.quietRanges.map(describeRange).join("; ") : "off",
        digest: input.digestEnabled ? input.digestTime : "off",
      },
    });
    refresh();
    return ok({ version: saved.settings.version }, "Saved.");
  },
);

// --- The daily digest --------------------------------------------------------------------------------------

export const previewDigestAction = adminAction(z.object({}).strict(), async (_input, { db }) => {
  const digest = await buildDigest(db, { at: now(), siteUrl: getEnv().SITE_URL });
  return ok({ subject: digest.subject, text: digest.text });
});

export const sendDigestNowAction = adminAction(z.object({}).strict(), async (_input, { db }) => {
  const channels = readChannels();
  if (!channels.ownerEmail) {
    return fail("Email alerts are off: set SMTP_* and NOTIFY_EMAIL_TO on the server.");
  }
  const at = now();
  const minute = Math.floor(at.getTime() / 60_000);
  const { queued } = await queueDigest(
    db,
    { siteUrl: getEnv().SITE_URL, channels },
    { at, key: `digest:${todayIn(ADMIN_TIME_ZONE, at)}:now:${minute}` },
  );
  if (!queued) return fail("A digest went out a moment ago. Try again in a minute.");
  sendQueuedSoon();
  return ok(null, `The digest is on its way to ${channels.ownerEmail}.`);
});
