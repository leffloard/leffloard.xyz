import { Writable } from "node:stream";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { alertBackupFailed } from "@/server/backup/service";
import { resetClock, setClock } from "@/server/clock";
import { closeClient } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { getEnv } from "@/server/env";
import { createLogger, setErrorSink } from "@/server/log";
import type { Channels } from "@/server/notify/channels";
import { notifications } from "@/server/notify/owner";
import { outbox } from "@/server/notify/outbox";
import { clearErrors, errorGroups, errorLog, startErrorLog, toErrorDoc } from "@/server/system/errors";
import { clearCspReports, cspGroups, databaseStatus, integrations } from "@/server/system/status";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

const { db, url, name } = setupTestDb();
setupTestEnv({ MONGO_URL: url, DB_NAME: name });

const NOW = new Date("2026-09-26T11:00:00Z");

beforeEach(async () => {
  await runMigrations(db());
  setClock(() => NOW);
});

afterEach(() => {
  setErrorSink(null);
  resetClock();
});

afterAll(async () => {
  await closeClient();
});

const quiet = () =>
  new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });

async function stored(count: number) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if ((await errorLog(db()).countDocuments()) >= count) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return errorLog(db()).find().sort({ at: 1, _id: 1 }).toArray();
}

describe("the error log", () => {
  it("keeps what the server logs at error level, without secrets", async () => {
    startErrorLog();
    const logger = createLogger(quiet(), "info");
    logger.info("just information");
    logger.warn("a warning");
    const failure = new TypeError("Cannot read properties of undefined");
    logger.error({ err: failure, job: "digest", password: "hunter2" }, "background job failed");
    const [entry, ...rest] = await stored(1);
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      level: "error",
      message: "background job failed",
      error: { type: "TypeError", message: "Cannot read properties of undefined" },
      context: { job: "digest" },
      at: NOW,
    });
    expect(entry?.error?.stack).toContain("TypeError: Cannot read properties of undefined");
    expect(JSON.stringify(entry)).not.toContain("hunter2");
    expect(entry?.purgeAt.getTime()).toBe(NOW.getTime() + 30 * 24 * 3600_000);
  });

  it("samples a flood instead of storing every line", async () => {
    // A minute of its own: the allowance is counted per minute.
    setClock(() => new Date(NOW.getTime() + 5 * 60_000));
    startErrorLog();
    const logger = createLogger(quiet(), "info");
    for (let count = 0; count < 40; count++) logger.error(`failure ${count}`);
    await stored(30);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await errorLog(db()).countDocuments()).toBe(30);
  });

  it("groups the same error, the latest first, and can be cleared", async () => {
    const line = (msg: string, type: string) => ({
      level: 50,
      msg,
      err: { type, message: `${type} happened` },
    });
    await errorLog(db()).insertMany([
      toErrorDoc(line("payment check failed", "FetchError"), new Date("2026-09-26T08:00:00Z")),
      toErrorDoc(line("payment check failed", "FetchError"), new Date("2026-09-26T09:00:00Z")),
      toErrorDoc(line("digest failed", "TypeError"), new Date("2026-09-26T08:30:00Z")),
      toErrorDoc({ level: 60, msg: "out of memory" }, new Date("2026-09-26T07:00:00Z")),
    ]);
    const groups = await errorGroups(db());
    expect(groups.map((group) => [group.message, group.count])).toEqual([
      ["payment check failed", 2],
      ["digest failed", 1],
      ["out of memory", 1],
    ]);
    expect(groups[0]).toMatchObject({ type: "FetchError", detail: "FetchError happened" });
    expect(groups[2]).toMatchObject({ type: null, detail: null, stack: null });
    expect(await clearErrors(db())).toBe(4);
    expect(await errorGroups(db())).toEqual([]);
  });
});

describe("the System page", () => {
  it("reports the database, its migrations and its collections", async () => {
    await db().collection("inquiries").insertOne({ subject: "hello" });
    const status = await databaseStatus(db());
    expect(status.error).toBeNull();
    expect(status.pingMs).toBeGreaterThanOrEqual(0);
    expect(status.pending).toEqual([]);
    expect(status.size?.documents).toBeGreaterThan(0);
    expect(status.collections.find((collection) => collection.name === "inquiries")).toMatchObject({
      documents: 1,
    });
  });

  it("lists the integrations and whether each is set up", () => {
    const rows = integrations(getEnv());
    expect(rows.find((row) => row.label === "Site address")).toEqual({
      label: "Site address",
      on: true,
      detail: "https://leffloard.test",
    });
    expect(rows.find((row) => row.label === "Backups")?.on).toBe(false);
    expect(rows.find((row) => row.label === "AI assistant (Anthropic)")?.detail).toBe(
      "off: no ANTHROPIC_API_KEY",
    );
  });

  it("groups Content Security Policy reports by what was blocked", async () => {
    const report = (blockedUrl: string, receivedAt: Date) => ({
      documentUrl: "https://leffloard.test/work",
      directive: "script-src-elem",
      blockedUrl,
      sourceFile: "",
      line: null,
      disposition: "enforce",
      sample: "",
      receivedAt,
      userAgent: "test",
    });
    await db()
      .collection("csp_reports")
      .insertMany([
        report("https://evil.example/x.js", new Date("2026-09-26T08:00:00Z")),
        report("https://evil.example/x.js", new Date("2026-09-26T10:00:00Z")),
        report("inline", new Date("2026-09-26T09:00:00Z")),
      ]);
    const groups = await cspGroups(db());
    expect(groups.map((group) => [group.blockedUrl, group.count])).toEqual([
      ["https://evil.example/x.js", 2],
      ["inline", 1],
    ]);
    expect(await clearCspReports(db())).toBe(3);
  });

  it("tells the owner about a failed backup once a day", async () => {
    const channels: Channels = {
      email: { delivery: "log", from: "site@leffloard.test" },
      ownerEmail: "owner@leffloard.test",
      discordWebhookUrl: null,
    };
    await alertBackupFailed(db(), "ENOSPC: no space left on device", channels, NOW);
    await alertBackupFailed(
      db(),
      "ENOSPC: no space left on device",
      channels,
      new Date(NOW.getTime() + 3600_000),
    );
    const stored = await notifications(db()).find().toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      kind: "problem",
      key: "backup:2026-09-26:failed",
      title: "The nightly backup failed",
      body: "ENOSPC: no space left on device",
      href: "/admin/system",
    });
    expect((await outbox(db()).find().toArray()).map((item) => item.dedupeKey)).toEqual([
      "backup:2026-09-26:failed:email",
    ]);
  });
});
