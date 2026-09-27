import "server-only";
import { MongoServerError, type Db } from "mongodb";
import { now } from "@/server/clock";
import { log } from "@/server/log";

// Runs a background job at most once at a time across every server process, and a periodic job once per
// period (a day, for the backup). The state lives in the `jobs` collection, so a job that was due while the
// server was down runs at the next check, and the admin can see when each job last ran.

export type JobDoc = {
  _id: string;
  lastPeriodKey: string | null; // the last period the job completed
  lockedUntil: Date; // a running job holds the lock; a failed one waits until then before retrying
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  lastOk: boolean | null;
  lastMessage: string | null;
  lastSuccessAt: Date | null;
  runs: number;
};

export type JobOutcome =
  { ran: false; reason: "busy" | "done" } | { ran: true; ok: boolean; message: string };

const DUPLICATE_KEY = 11000;

export function jobs(db: Db) {
  return db.collection<JobDoc>("jobs");
}

async function ensureJob(db: Db, name: string): Promise<void> {
  try {
    await jobs(db).updateOne(
      { _id: name },
      {
        $setOnInsert: {
          lastPeriodKey: null,
          lockedUntil: new Date(0),
          lastStartedAt: null,
          lastFinishedAt: null,
          lastOk: null,
          lastMessage: null,
          lastSuccessAt: null,
          runs: 0,
        },
      },
      { upsert: true },
    );
  } catch (error) {
    // Two processes creating the record at the same moment: one wins, which is all that is needed.
    if (!(error instanceof MongoServerError && error.code === DUPLICATE_KEY)) throw error;
  }
}

export type RunOptions = {
  // Periodic jobs: the current period ("2026-09-26"), or null when the job is not due yet.
  periodKey?: string | null;
  lockMs: number;
  retryAfterFailureMs?: number;
};

export async function runJob(
  db: Db,
  name: string,
  run: () => Promise<string>,
  { periodKey, lockMs, retryAfterFailureMs = 60 * 60_000 }: RunOptions,
): Promise<JobOutcome> {
  if (periodKey === null) return { ran: false, reason: "done" };
  await ensureJob(db, name);
  const startedAt = now();
  const claimed = await jobs(db).findOneAndUpdate(
    {
      _id: name,
      lockedUntil: { $lte: startedAt },
      ...(periodKey ? { lastPeriodKey: { $ne: periodKey } } : {}),
    },
    {
      $set: { lockedUntil: new Date(startedAt.getTime() + lockMs), lastStartedAt: startedAt },
      $inc: { runs: 1 },
    },
    { returnDocument: "after" },
  );
  if (!claimed) {
    const current = await jobs(db).findOne({ _id: name }, { projection: { lastPeriodKey: 1 } });
    return { ran: false, reason: periodKey && current?.lastPeriodKey === periodKey ? "done" : "busy" };
  }

  try {
    const message = await run();
    const finishedAt = now();
    await jobs(db).updateOne(
      { _id: name },
      {
        $set: {
          lockedUntil: new Date(0),
          lastFinishedAt: finishedAt,
          lastSuccessAt: finishedAt,
          lastOk: true,
          lastMessage: message.slice(0, 500),
          ...(periodKey ? { lastPeriodKey: periodKey } : {}),
        },
      },
    );
    return { ran: true, ok: true, message };
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    const finishedAt = now();
    await jobs(db).updateOne(
      { _id: name },
      {
        $set: {
          lockedUntil: new Date(finishedAt.getTime() + retryAfterFailureMs),
          lastFinishedAt: finishedAt,
          lastOk: false,
          lastMessage: message,
        },
      },
    );
    log.error({ job: name, error: message }, "background job failed");
    return { ran: true, ok: false, message };
  }
}

export async function listJobs(db: Db): Promise<JobDoc[]> {
  return jobs(db).find().sort({ _id: 1 }).toArray();
}
