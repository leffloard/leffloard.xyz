import "server-only";
import { ObjectId, type ClientSession, type Db, type Document, type Filter } from "mongodb";
import { fitsBudget, monthKey } from "@/lib/ai/budget";
import { AI_RUN_RETENTION_DAYS, type AiFeature } from "@/lib/ai/features";
import { NO_TOKENS, type TokenUsage } from "@/lib/ai/pricing";
import { aiCounters, aiMonths, aiRuns } from "@/server/ai/collections";
import type { AiMonthDoc, AiRunDoc, AiRunStatus, AiTarget } from "@/server/ai/types";
import { now } from "@/server/clock";

// The budget's bookkeeping and the runs' record. A request first reserves the most it could cost in its
// month (refused if that would pass the budget), then records its run; when it ends, the reservation is
// swapped for what it cost. Only the update that ends a run settles it, so nothing is counted twice.

const DAY_MS = 86_400_000;
// A run still "running" after this long lost its server (a restart mid-request): it is closed and counted
// at its reservation, since what Anthropic billed is unknown.
const STALE_MS = 30 * 60_000;

export type Reserved = { ok: true; month: string; amount: number } | { ok: false; leftMicros: number };

export async function reserve(db: Db, amount: number, budget: number, at: Date = now()): Promise<Reserved> {
  const month = monthKey(at);
  await aiMonths(db).updateOne(
    { _id: month },
    {
      $setOnInsert: {
        spentMicros: 0,
        reservedMicros: 0,
        runs: 0,
        usage: NO_TOKENS,
        byFeature: {},
        expenseId: null,
        updatedAt: at,
      },
    },
    { upsert: true },
  );
  const taken = await aiMonths(db).updateOne(
    { _id: month, $expr: { $lte: [{ $add: ["$spentMicros", "$reservedMicros", amount] }, budget] } },
    { $inc: { reservedMicros: amount }, $set: { updatedAt: at } },
  );
  if (taken.modifiedCount === 1) return { ok: true, month, amount };
  const doc = await aiMonths(db).findOne({ _id: month });
  const spent = doc?.spentMicros ?? 0;
  const reserved = doc?.reservedMicros ?? 0;
  return { ok: false, leftMicros: fitsBudget(budget, spent, reserved, 0) ? budget - spent - reserved : 0 };
}

export async function release(db: Db, month: string, amount: number): Promise<void> {
  await aiMonths(db).updateOne({ _id: month }, { $inc: { reservedMicros: -amount } });
}

async function settleMonth(
  db: Db,
  month: string,
  feature: AiFeature,
  reserved: number,
  cost: number,
  usage: TokenUsage,
  at: Date,
): Promise<void> {
  await aiMonths(db).updateOne(
    { _id: month },
    {
      $inc: {
        reservedMicros: -reserved,
        spentMicros: cost,
        runs: 1,
        "usage.input": usage.input,
        "usage.output": usage.output,
        "usage.cacheRead": usage.cacheRead,
        "usage.cacheWrite5m": usage.cacheWrite5m,
        "usage.cacheWrite1h": usage.cacheWrite1h,
        [`byFeature.${feature}.runs`]: 1,
        [`byFeature.${feature}.costMicros`]: cost,
      },
      $set: { updatedAt: at },
    },
  );
}

export type NewRun = {
  feature: AiFeature;
  trigger: "owner" | "auto";
  target: AiTarget | null;
  clientId: ObjectId | null;
  lock: string;
  model: string;
  month: string; // where the reservation was taken
  reservedMicros: number;
};

// Records a started run; "busy" when the same feature is already running for the same target.
export async function startRun(db: Db, run: NewRun, at: Date = now()): Promise<ObjectId | "busy"> {
  const doc: AiRunDoc = {
    _id: new ObjectId(),
    ...run,
    status: "running",
    servedBy: null,
    fallback: false,
    costMicros: 0,
    usage: NO_TOKENS,
    stopReason: null,
    refusal: null,
    output: null,
    error: null,
    requestId: null,
    durationMs: null,
    createdAt: at,
    finishedAt: null,
    purgeAt: new Date(at.getTime() + AI_RUN_RETENTION_DAYS * DAY_MS),
  };
  try {
    await aiRuns(db).insertOne(doc);
    return doc._id;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return "busy";
    throw error;
  }
}

export type RunOutcome = {
  status: Exclude<AiRunStatus, "running">;
  servedBy: string | null;
  fallback: boolean;
  costMicros: number;
  usage: TokenUsage;
  stopReason: string | null;
  refusal: string | null;
  output: string | null;
  error: string | null;
  requestId: string | null;
  durationMs: number | null;
};

// Ends a run and settles the month its reservation came from. False when it had already been closed (by
// the stale sweep). A run whose subject was deleted meanwhile is settled, then deleted.
export async function finishRun(
  db: Db,
  id: ObjectId,
  outcome: RunOutcome,
  at: Date = now(),
): Promise<boolean> {
  const run = await aiRuns(db).findOneAndUpdate(
    { _id: id, status: "running" },
    { $set: { ...outcome, finishedAt: at }, $unset: { lock: "" } },
    { returnDocument: "after" },
  );
  if (!run) return false;
  await settleMonth(db, run.month, run.feature, run.reservedMicros, outcome.costMicros, outcome.usage, at);
  if (run.discard) await aiRuns(db).deleteOne({ _id: id });
  return true;
}

export async function sweepStaleRuns(db: Db, at: Date = now()): Promise<number> {
  const stale = await aiRuns(db)
    .find({ status: "running", createdAt: { $lt: new Date(at.getTime() - STALE_MS) } })
    .limit(50)
    .toArray();
  let closed = 0;
  for (const run of stale) {
    const ended = await finishRun(
      db,
      run._id,
      {
        status: "failed",
        servedBy: null,
        fallback: false,
        costMicros: run.reservedMicros,
        usage: NO_TOKENS,
        stopReason: null,
        refusal: null,
        output: null,
        error:
          "No answer was recorded (the server may have restarted). Counted at the most it could have cost.",
        requestId: null,
        durationMs: null,
      },
      at,
    );
    if (ended) closed += 1;
  }
  return closed;
}

// --- Reading ----------------------------------------------------------------------------------------------

export async function getMonth(db: Db, month: string): Promise<AiMonthDoc | null> {
  return aiMonths(db).findOne({ _id: month });
}

export async function listMonths(db: Db, limit = 12): Promise<AiMonthDoc[]> {
  return aiMonths(db).find().sort({ _id: -1 }).limit(limit).toArray();
}

export async function listRuns(db: Db, limit = 50): Promise<AiRunDoc[]> {
  return aiRuns(db).find().sort({ createdAt: -1 }).limit(limit).toArray();
}

export async function getRun(db: Db, id: ObjectId): Promise<AiRunDoc | null> {
  return aiRuns(db).findOne({ _id: id });
}

// The newest finished draft of a feature for a target (the brief shown on a meeting's page).
export async function latestDraft(db: Db, feature: AiFeature, target: AiTarget): Promise<AiRunDoc | null> {
  return aiRuns(db).findOne(
    { feature, "target.kind": target.kind, "target.id": target.id, status: "done" },
    { sort: { createdAt: -1 } },
  );
}

// Which of these meetings have a brief ready.
export async function briefedMeetings(db: Db, ids: ObjectId[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const found = await aiRuns(db).distinct("target.id", {
    feature: "brief",
    status: "done",
    "target.kind": "meeting",
    "target.id": { $in: ids },
  });
  return new Set(found.map((id) => String(id)));
}

// Takes one of `limit` uses of a daily allowance (the key names the day); false when none is left. One
// conditional update, so two requests at the same moment can't both take the last one.
export async function claimDaily(db: Db, key: string, limit: number, expiresAt: Date): Promise<boolean> {
  try {
    await aiCounters(db).updateOne(
      { _id: key, count: { $lt: limit } },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true },
    );
    return true;
  } catch (error) {
    // The day's document exists and is full: the upsert's insert collides with it.
    if ((error as { code?: number }).code === 11000) return false;
    throw error;
  }
}

// --- Removal with what they are about -----------------------------------------------------------------------

// Deletes the runs matching `filter`. One still running is only cut loose from what it was about (its
// draft is never kept): it settles its cost when it ends, then deletes itself.
async function removeRuns(db: Db, filter: Filter<AiRunDoc>, session?: ClientSession): Promise<number> {
  const detached = await aiRuns(db).updateMany(
    { ...filter, status: "running" },
    { $set: { discard: true, target: null, clientId: null } },
    { session },
  );
  const deleted = await aiRuns(db).deleteMany({ ...filter, status: { $ne: "running" } }, { session });
  return detached.modifiedCount + deleted.deletedCount;
}

export async function deleteRunsFor(db: Db, target: AiTarget, session?: ClientSession): Promise<number> {
  return removeRuns(db, { "target.kind": target.kind, "target.id": target.id }, session);
}

export async function deleteRunsForClient(
  db: Db,
  clientId: ObjectId,
  session?: ClientSession,
): Promise<number> {
  return removeRuns(db, { clientId }, session);
}

// Runs about an inbox message or meeting that no longer exists (deleted by its own retention, such as spam
// after 30 days) go too, soon after.
export async function purgeOrphanRuns(db: Db): Promise<number> {
  let removed = 0;
  for (const [kind, collection] of [
    ["inquiry", "inquiries"],
    ["meeting", "meetings"],
  ] as const) {
    const orphans = await aiRuns(db)
      .aggregate<{ _id: ObjectId }>([
        { $match: { "target.kind": kind, status: { $ne: "running" } } },
        { $lookup: { from: collection, localField: "target.id", foreignField: "_id", as: "subject" } },
        { $match: { subject: { $size: 0 } } },
        { $project: { _id: 1 } },
      ] as Document[])
      .toArray();
    if (orphans.length) {
      const result = await aiRuns(db).deleteMany({ _id: { $in: orphans.map((orphan) => orphan._id) } });
      removed += result.deletedCount;
    }
  }
  return removed;
}
