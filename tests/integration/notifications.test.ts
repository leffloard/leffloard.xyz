import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultRoutes } from "@/lib/notifications/model";
import { resetClock, setClock } from "@/server/clock";
import { closeClient } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import type { Channels } from "@/server/notify/channels";
import { drainOutbox, enqueue, outbox } from "@/server/notify/outbox";
import {
  alertOwner,
  countUnread,
  listNotifications,
  markRead,
  markUnread,
  notifications,
  type OwnerAlert,
} from "@/server/notify/owner";
import {
  defaultNotificationSettings,
  getNotificationSettings,
  saveNotificationSettings,
} from "@/server/notify/settings";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

const { db, url, name } = setupTestDb();
setupTestEnv({ MONGO_URL: url, DB_NAME: name });

// 14:00 in Istanbul on Saturday 26 September 2026.
const NOW = new Date("2026-09-26T11:00:00Z");

const CHANNELS: Channels = {
  email: { delivery: "log", from: "site@leffloard.test" },
  ownerEmail: "owner@leffloard.test",
  discordWebhookUrl: "https://discord.test/api/webhooks/1/abc",
};

function alert(key: string, overrides: Partial<OwnerAlert> = {}): OwnerAlert {
  return {
    kind: "inquiry",
    key,
    label: `Alert for ${key}`,
    title: `New message ${key}`,
    body: "Moderation bot",
    href: "/admin/inbox/1",
    email: (to) => ({ to: [{ address: to }], subject: `About ${key}`, text: "Hello\n" }),
    discord: () => ({ embeds: [], allowed_mentions: { parse: [] } }),
    ...overrides,
  };
}

async function settings(change: Partial<ReturnType<typeof defaultNotificationSettings>>) {
  const { version, ...current } = await getNotificationSettings(db());
  const saved = await saveNotificationSettings(db(), { ...current, ...change }, version);
  if (!saved.ok) throw new Error("settings not saved");
}

beforeEach(async () => {
  await runMigrations(db());
  setClock(() => NOW);
});

afterEach(() => resetClock());

afterAll(async () => {
  await closeClient();
});

describe("alerts for the owner", () => {
  it("show in the notification centre once, and go by email and to Discord", async () => {
    await alertOwner(db(), CHANNELS, alert("inquiry:1"));
    await alertOwner(db(), CHANNELS, alert("inquiry:1"));
    const stored = await notifications(db()).find().toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      kind: "inquiry",
      key: "inquiry:1",
      title: "New message inquiry:1",
      body: "Moderation bot",
      href: "/admin/inbox/1",
      readAt: null,
      createdAt: NOW,
    });
    const items = await outbox(db()).find().sort({ createdAt: 1, _id: 1 }).toArray();
    expect(items.map((item) => [item.channel, item.dedupeKey, item.label])).toEqual([
      ["discord", "inquiry:1:discord", "Alert for inquiry:1"],
      ["email", "inquiry:1:email", "Alert for inquiry:1"],
    ]);
    expect(items.every((item) => item.nextAttemptAt.getTime() === NOW.getTime())).toBe(true);
  });

  it("follow the routes chosen for their kind, and only configured channels", async () => {
    await settings({ routes: { ...defaultRoutes(), payment: { email: false, discord: true } } });
    await alertOwner(db(), CHANNELS, alert("payment:1", { kind: "payment" }));
    await alertOwner(db(), { ...CHANNELS, discordWebhookUrl: null }, alert("payment:2", { kind: "payment" }));
    await alertOwner(db(), { ...CHANNELS, discordWebhookUrl: null, ownerEmail: null }, alert("inquiry:3"));
    const items = await outbox(db()).find().toArray();
    expect(items.map((item) => item.dedupeKey)).toEqual(["payment:1:discord"]);
    // The notification centre gets every one.
    expect(await countUnread(db())).toBe(3);
  });

  it("are held during quiet hours, and shown in the admin at once", async () => {
    await settings({
      quietEnabled: true,
      quietRanges: [{ days: [0, 1, 2, 3, 4, 5, 6], start: "23:00", end: "07:00" }],
    });
    // 01:30 in Istanbul on Sunday.
    const night = new Date("2026-09-26T22:30:00Z");
    await alertOwner(db(), CHANNELS, alert("inquiry:night"), night);
    const items = await outbox(db()).find().toArray();
    expect(items).toHaveLength(2);
    // 07:00 in Istanbul.
    expect(items.every((item) => item.nextAttemptAt.toISOString() === "2026-09-27T04:00:00.000Z")).toBe(true);
    expect((await notifications(db()).findOne({ key: "inquiry:night" }))?.createdAt).toEqual(night);

    await alertOwner(db(), CHANNELS, alert("inquiry:day"), NOW);
    const day = await outbox(db())
      .find({ dedupeKey: /^inquiry:day/ })
      .toArray();
    expect(day.every((item) => item.nextAttemptAt.getTime() === NOW.getTime())).toBe(true);
  });
});

describe("quiet hours in the outbox", () => {
  it("hold an alert queued just before them, and a retry that falls into them", async () => {
    await settings({
      quietEnabled: true,
      quietRanges: [{ days: [0, 1, 2, 3, 4, 5, 6], start: "23:00", end: "07:00" }],
    });
    // 22:59:30 in Istanbul: queued to go at once.
    const before = new Date("2026-09-26T19:59:30Z");
    await alertOwner(db(), { ...CHANNELS, discordWebhookUrl: null }, alert("inquiry:late"), before);
    // The outbox runs at 23:00:10: the alert waits for the morning, with its attempt given back.
    setClock(() => new Date("2026-09-26T20:00:10Z"));
    const sends: string[] = [];
    const senders = {
      channels: () => CHANNELS,
      sendEmail: async (message: { subject: string }) => {
        sends.push(message.subject);
      },
      postDiscord: async () => undefined,
    };
    expect(await drainOutbox(db(), { senders })).toMatchObject({ sent: 0, held: 1 });
    const [held] = await outbox(db()).find().toArray();
    expect(held).toMatchObject({ status: "pending", attempts: 0 });
    expect(held?.nextAttemptAt.toISOString()).toBe("2026-09-27T04:00:00.000Z");

    // At 07:00 it goes.
    setClock(() => new Date("2026-09-27T04:00:00Z"));
    expect(await drainOutbox(db(), { senders })).toMatchObject({ sent: 1, held: 0 });
    expect(sends).toEqual(["About inquiry:late"]);

    // Other messages (a client's email) aren't held.
    setClock(() => new Date("2026-09-27T20:30:00Z"));
    await enqueue(db(), {
      channel: "email",
      payload: { to: [{ address: "client@example.com" }], subject: "Your invoice", text: "Hi\n" },
      dedupeKey: "invoice:1",
      label: "Invoice to a client",
    });
    expect(await drainOutbox(db(), { senders })).toMatchObject({ sent: 1, held: 0 });
  });
});

describe("the notification centre", () => {
  it("lists the newest first, and marks them read and unread", async () => {
    for (const [index, key] of ["a", "b", "c"].entries()) {
      await alertOwner(db(), CHANNELS, alert(key), new Date(NOW.getTime() + index * 60_000));
    }
    expect((await listNotifications(db())).map((row) => row.key)).toEqual(["c", "b", "a"]);
    const [c] = await listNotifications(db());
    expect(await markRead(db(), [c!._id])).toBe(1);
    expect(await countUnread(db())).toBe(2);
    expect((await listNotifications(db(), { unreadOnly: true })).map((row) => row.key)).toEqual(["b", "a"]);
    expect(await markRead(db(), "all")).toBe(2);
    expect(await countUnread(db())).toBe(0);
    expect(await markUnread(db(), c!._id)).toBe(true);
    expect(await countUnread(db())).toBe(1);
  });

  it("keeps notification settings, refusing a save from an older copy", async () => {
    expect(await getNotificationSettings(db())).toEqual(defaultNotificationSettings());
    const { version, ...input } = defaultNotificationSettings();
    const first = await saveNotificationSettings(db(), { ...input, digestEnabled: true }, version);
    expect(first).toMatchObject({ ok: true, settings: { version: 1, digestEnabled: true } });
    expect(await saveNotificationSettings(db(), input, 0)).toEqual({ ok: false, reason: "conflict" });
    expect(await saveNotificationSettings(db(), { ...input, digestTime: "08:00" }, 1)).toMatchObject({
      ok: true,
      settings: { version: 2 },
    });
    expect((await getNotificationSettings(db())).digestTime).toBe("08:00");
  });
});
