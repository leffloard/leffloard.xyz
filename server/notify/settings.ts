import "server-only";
import type { Db } from "mongodb";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import {
  ALERT_KINDS,
  DEFAULT_DIGEST_TIME,
  DEFAULT_QUIET_RANGES,
  defaultRoutes,
  quietUntil,
  type QuietRange,
  type Routes,
} from "@/lib/notifications/model";
import { now } from "@/server/clock";

// Where each kind of alert goes, the quiet hours and the daily digest: one document in `settings`.

export type NotificationSettings = {
  routes: Routes;
  quietEnabled: boolean;
  quietRanges: QuietRange[];
  digestEnabled: boolean;
  digestTime: string; // "07:30" in the admin's time zone
  version: number; // 0 until first saved
};

type NotificationSettingsDoc = Omit<NotificationSettings, "version"> & {
  _id: "notifications";
  version: number;
  updatedAt: Date;
};

function collection(db: Db) {
  return db.collection<NotificationSettingsDoc>("settings");
}

export function defaultNotificationSettings(): NotificationSettings {
  return {
    routes: defaultRoutes(),
    quietEnabled: false,
    quietRanges: DEFAULT_QUIET_RANGES.map((range) => ({ ...range, days: [...range.days] })),
    digestEnabled: false,
    digestTime: DEFAULT_DIGEST_TIME,
    version: 0,
  };
}

export async function getNotificationSettings(db: Db): Promise<NotificationSettings> {
  const doc = await collection(db).findOne({ _id: "notifications" });
  const defaults = defaultNotificationSettings();
  if (!doc) return defaults;
  // A kind added in a later release starts with the default route.
  const routes = { ...defaults.routes };
  for (const kind of ALERT_KINDS) if (doc.routes?.[kind]) routes[kind] = doc.routes[kind];
  return {
    routes,
    quietEnabled: doc.quietEnabled,
    quietRanges: doc.quietRanges,
    digestEnabled: doc.digestEnabled,
    digestTime: doc.digestTime,
    version: doc.version,
  };
}

export type SavedNotificationSettings =
  { ok: true; settings: NotificationSettings } | { ok: false; reason: "conflict" };

// Saves the settings opened at `version` (0 before the first save); a newer save elsewhere wins.
export async function saveNotificationSettings(
  db: Db,
  input: Omit<NotificationSettings, "version">,
  version: number,
  at: Date = now(),
): Promise<SavedNotificationSettings> {
  if (version === 0) {
    const inserted = await collection(db).updateOne(
      { _id: "notifications" },
      { $setOnInsert: { ...input, version: 1, updatedAt: at } },
      { upsert: true },
    );
    if (inserted.upsertedCount !== 1) return { ok: false, reason: "conflict" };
    return { ok: true, settings: { ...input, version: 1 } };
  }
  const updated = await collection(db).findOneAndUpdate(
    { _id: "notifications", version },
    { $set: { ...input, updatedAt: at }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
  if (!updated) return { ok: false, reason: "conflict" };
  return { ok: true, settings: { ...input, version: updated.version } };
}

// When the quiet period `at` falls in ends; null when quiet hours are off or it isn't one.
export async function quietHoursEnd(db: Db, at: Date): Promise<Date | null> {
  const settings = await getNotificationSettings(db);
  return settings.quietEnabled ? quietUntil(settings.quietRanges, at, ADMIN_TIME_ZONE) : null;
}
