import "server-only";
import path from "node:path";
import type { Db } from "mongodb";
import { ADMIN_TIME_ZONE, formatBytes } from "@/lib/format";
import { todayIn, wallDateTime } from "@/lib/intake/time";
import { createBackup, listBackups, type BackupFile } from "@/server/backup/backup";
import { now } from "@/server/clock";
import { getEnv, type Env } from "@/server/env";
import { jobs, runJob, type JobDoc, type JobOutcome } from "@/server/jobs/runner";
import type { Channels } from "@/server/notify/channels";
import { discordSafe } from "@/server/notify/escape";
import { alertOwner } from "@/server/notify/owner";

// The nightly backup: once a day from 03:15 (the owner's time), or at the first check after that when the
// server was off at 03:15.

export const BACKUP_JOB = "backup";
export const BACKUP_TIME = "03:15";
const DEFAULT_KEEP = 14;
const STALE_AFTER_MS = 36 * 3600_000;

export type BackupConfig = { key: Buffer; dir: string; keep: number };

export function backupConfig(env: Env = getEnv()): BackupConfig | null {
  if (!env.BACKUP_KEY || !env.BACKUP_DIR) return null;
  return { key: env.BACKUP_KEY, dir: path.resolve(env.BACKUP_DIR), keep: env.BACKUP_KEEP ?? DEFAULT_KEEP };
}

// Today's date where the owner is, once the backup time has passed; null before it.
export function backupPeriodKey(at: Date, zone: string = ADMIN_TIME_ZONE): string | null {
  return wallDateTime(at, zone).time >= BACKUP_TIME ? todayIn(zone, at) : null;
}

export async function runBackup(db: Db, { now: force }: { now: boolean }): Promise<JobOutcome | null> {
  const config = backupConfig();
  if (!config) return null;
  return runJob(
    db,
    BACKUP_JOB,
    async () => {
      const result = await createBackup(db, config);
      return `${result.name}: ${result.documents} documents, ${formatBytes(result.bytes)}`;
    },
    { periodKey: force ? undefined : backupPeriodKey(now()), lockMs: 30 * 60_000 },
  );
}

export type BackupStatus = {
  state: "off" | "ok" | "stale" | "failed";
  dir: string | null;
  keep: number | null;
  last: JobDoc | null;
  files: BackupFile[];
};

export async function backupStatus(db: Db): Promise<BackupStatus> {
  const config = backupConfig();
  const last = await jobs(db).findOne({ _id: BACKUP_JOB });
  if (!config) return { state: "off", dir: null, keep: null, last, files: [] };
  const files = await listBackups(config.dir, db.databaseName);
  let state: BackupStatus["state"] = "ok";
  if (last?.lastOk === false) state = "failed";
  else if (!last?.lastSuccessAt || now().getTime() - last.lastSuccessAt.getTime() > STALE_AFTER_MS)
    state = "stale";
  return { state, dir: config.dir, keep: config.keep, last, files };
}

// A backup that failed: the owner is told once a day, in the notification centre and as the routes say.
export async function alertBackupFailed(
  db: Db,
  message: string,
  channels: Channels,
  at: Date,
): Promise<void> {
  const day = todayIn(ADMIN_TIME_ZONE, at);
  const text = `The nightly backup failed: ${message}`;
  await alertOwner(
    db,
    channels,
    {
      kind: "problem",
      key: `backup:${day}:failed`,
      label: `Backup failed, ${day}`,
      title: "The nightly backup failed",
      body: message,
      href: "/admin/system",
      email: (to) => ({
        to: [{ address: to }],
        subject: "The nightly backup failed",
        text: `${text}\n\nIt is tried again within the hour. See the System page: ${getEnv().SITE_URL}/admin/system\n`,
      }),
      discord: () => ({
        embeds: [
          {
            title: "The nightly backup failed",
            color: 0xf87171,
            description: discordSafe(message, 1500),
            fields: [],
            footer: { text: "leffloard.xyz system" },
            timestamp: at.toISOString(),
          },
        ],
        allowed_mentions: { parse: [] },
      }),
    },
    at,
  );
}
