import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backupPeriodKey, backupStatus, runBackup } from "@/server/backup/service";
import { resetClock, setClock } from "@/server/clock";
import { clearEnvCache } from "@/server/env";
import { jobs, listJobs, runJob } from "@/server/jobs/runner";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

setupTestEnv();
const { db } = setupTestDb();

let clock = new Date("2026-09-26T00:30:00Z");
beforeEach(() => {
  clock = new Date("2026-09-26T00:30:00Z");
  setClock(() => clock);
});
afterEach(() => resetClock());

describe("runJob", () => {
  it("runs a periodic job once per period, whichever process gets there first", async () => {
    let runs = 0;
    const job = () =>
      runJob(
        db(),
        "nightly",
        async () => {
          runs++;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return "done";
        },
        { periodKey: "2026-09-26", lockMs: 60_000 },
      );
    const outcomes = await Promise.all([job(), job(), job()]);
    expect(runs).toBe(1);
    expect(outcomes.filter((outcome) => outcome.ran)).toHaveLength(1);
    expect(await job()).toEqual({ ran: false, reason: "done" });
    const next = await runJob(db(), "nightly", async () => "again", {
      periodKey: "2026-09-27",
      lockMs: 60_000,
    });
    expect(next).toEqual({ ran: true, ok: true, message: "again" });
  });

  it("waits before retrying a failed job, and records what happened", async () => {
    const failing = () =>
      runJob(
        db(),
        "flaky",
        async () => {
          throw new Error("disk full");
        },
        { periodKey: "2026-09-26", lockMs: 60_000, retryAfterFailureMs: 3600_000 },
      );
    expect(await failing()).toEqual({ ran: true, ok: false, message: "disk full" });
    expect(await failing()).toEqual({ ran: false, reason: "busy" });
    clock = new Date(clock.getTime() + 3600_000);
    expect(await failing()).toMatchObject({ ran: true, ok: false });
    const [record] = await listJobs(db());
    expect(record).toMatchObject({
      _id: "flaky",
      lastOk: false,
      lastMessage: "disk full",
      lastPeriodKey: null,
      runs: 2,
    });
  });

  it("skips a job that is not due yet", async () => {
    expect(await runJob(db(), "later", async () => "x", { periodKey: null, lockMs: 1000 })).toEqual({
      ran: false,
      reason: "done",
    });
    expect(await jobs(db()).countDocuments()).toBe(0);
  });
});

describe("the nightly backup", () => {
  it("is due from 03:15 Istanbul time, once per local day", () => {
    expect(backupPeriodKey(new Date("2026-09-26T00:14:00Z"))).toBeNull(); // 03:14 in Istanbul
    expect(backupPeriodKey(new Date("2026-09-26T00:15:00Z"))).toBe("2026-09-26");
    expect(backupPeriodKey(new Date("2026-09-26T20:59:00Z"))).toBe("2026-09-26"); // 23:59
    expect(backupPeriodKey(new Date("2026-09-26T21:01:00Z"))).toBeNull(); // 00:01 on the 27th
  });

  it("runs when configured, catches up after downtime, and reports its state", async () => {
    expect(await runBackup(db(), { now: false })).toBeNull();
    expect((await backupStatus(db())).state).toBe("off");

    const dir = await mkdtemp(path.join(tmpdir(), "leffloard-jobs-test-"));
    vi.stubEnv("BACKUP_KEY", Buffer.alloc(32, 5).toString("base64"));
    vi.stubEnv("BACKUP_DIR", dir);
    clearEnvCache();
    try {
      await db().collection("inquiries").insertOne({ hello: "world" });
      // 03:30 in Istanbul: due.
      const first = await runBackup(db(), { now: false });
      expect(first).toMatchObject({ ran: true, ok: true });
      expect(await runBackup(db(), { now: false })).toEqual({ ran: false, reason: "done" });
      // "Back up now" runs anyway, without using up the night's run.
      expect(await runBackup(db(), { now: true })).toMatchObject({ ran: true, ok: true });
      const status = await backupStatus(db());
      expect(status.state).toBe("ok");
      expect(status.files.length).toBeGreaterThanOrEqual(1);

      clock = new Date(clock.getTime() + 40 * 3600_000);
      expect((await backupStatus(db())).state).toBe("stale");
    } finally {
      vi.unstubAllEnvs();
      setupEnvAgain();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// setupTestEnv's values, stubbed again after the test's own changes.
function setupEnvAgain(): void {
  vi.stubEnv("MONGO_URL", "mongodb://127.0.0.1:1/unused");
  vi.stubEnv("SITE_URL", "https://leffloard.test");
  vi.stubEnv("DATA_ENCRYPTION_KEYS", `1:${Buffer.alloc(32, 1).toString("base64")}`);
  clearEnvCache();
}
