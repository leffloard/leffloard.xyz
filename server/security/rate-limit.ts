import "server-only";
import type { Db } from "mongodb";
import { now } from "@/server/clock";

// Sliding-window limiter stored in MongoDB, so limits hold across restarts and processes. Each key keeps
// the times of its recent allowed attempts; blocked attempts are not recorded and do not extend the wait.
// (Same rules as the v1 backend's in-memory RateLimiter.)

export type RateLimit = { limit: number; windowMs: number };
export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

type RateLimitDoc = { _id: string; hits: Date[]; blocked: boolean; expiresAt: Date };

export async function hitRateLimit(
  db: Db,
  key: string,
  { limit, windowMs }: RateLimit,
): Promise<RateLimitResult> {
  const at = now();
  const cutoff = new Date(at.getTime() - windowMs);
  const doc = await db.collection<RateLimitDoc>("rate_limits").findOneAndUpdate(
    { _id: key },
    [
      {
        $set: { hits: { $filter: { input: { $ifNull: ["$hits", []] }, cond: { $gt: ["$$this", cutoff] } } } },
      },
      { $set: { blocked: { $gte: [{ $size: "$hits" }, limit] } } },
      {
        $set: {
          hits: { $cond: ["$blocked", "$hits", { $concatArrays: ["$hits", [at]] }] },
          expiresAt: new Date(at.getTime() + windowMs),
        },
      },
    ],
    { upsert: true, returnDocument: "after", projection: { hits: 1, blocked: 1 } },
  );
  if (!doc?.blocked) return { allowed: true };
  const oldest = doc.hits[0]?.getTime() ?? at.getTime();
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - at.getTime()) / 1000)),
  };
}

// Forgets the most recent attempt, e.g. after a successful sign-in, so typos before it do not count.
export async function releaseRateLimit(db: Db, key: string): Promise<void> {
  await db.collection<RateLimitDoc>("rate_limits").updateOne({ _id: key }, { $pop: { hits: 1 } });
}
