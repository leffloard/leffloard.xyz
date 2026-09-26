import "server-only";
import type { Db } from "mongodb";
import { now } from "@/server/clock";
import { sha256Hex } from "@/server/security/crypto";

// Progressive lock after failed sign-ins for one email address: from the 5th failure 15 minutes, from the
// 10th one hour, from the 20th a day. Failures older than a day are forgotten. Unknown addresses are counted
// the same way, so the lock does not reveal which accounts exist. Passkey sign-in ignores this lock, so an
// attacker cannot keep the owner out.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DECAY_MS = 24 * HOUR;

type LockoutDoc = {
  _id: string;
  failures: number;
  lastFailureAt: Date;
  lockedUntil: Date | null;
  expiresAt: Date;
};

export function lockDurationMs(failures: number): number {
  if (failures >= 20) return 24 * HOUR;
  if (failures >= 10) return HOUR;
  if (failures >= 5) return 15 * MINUTE;
  return 0;
}

export function lockoutKey(email: string): string {
  return sha256Hex(`login:${email.trim().toLowerCase()}`);
}

export async function lockedUntil(db: Db, email: string): Promise<Date | null> {
  const doc = await db
    .collection<LockoutDoc>("login_lockouts")
    .findOne({ _id: lockoutKey(email) }, { projection: { lockedUntil: 1 } });
  return doc?.lockedUntil && doc.lockedUntil > now() ? doc.lockedUntil : null;
}

export async function recordLoginFailure(
  db: Db,
  email: string,
): Promise<{ failures: number; lockedUntil: Date | null }> {
  const at = now();
  const plus = (ms: number) => new Date(at.getTime() + ms);
  const doc = await db.collection<LockoutDoc>("login_lockouts").findOneAndUpdate(
    { _id: lockoutKey(email) },
    [
      {
        $set: {
          failures: {
            $cond: [
              { $lt: [{ $ifNull: ["$lastFailureAt", new Date(0)] }, new Date(at.getTime() - DECAY_MS)] },
              1,
              { $add: ["$failures", 1] },
            ],
          },
          lastFailureAt: at,
        },
      },
      {
        $set: {
          lockedUntil: {
            $switch: {
              branches: [
                { case: { $gte: ["$failures", 20] }, then: plus(lockDurationMs(20)) },
                { case: { $gte: ["$failures", 10] }, then: plus(lockDurationMs(10)) },
                { case: { $gte: ["$failures", 5] }, then: plus(lockDurationMs(5)) },
              ],
              default: null,
            },
          },
          expiresAt: plus(2 * DECAY_MS),
        },
      },
    ],
    { upsert: true, returnDocument: "after" },
  );
  return { failures: doc?.failures ?? 1, lockedUntil: doc?.lockedUntil ?? null };
}

export async function clearLoginFailures(db: Db, email: string): Promise<void> {
  await db.collection<LockoutDoc>("login_lockouts").deleteOne({ _id: lockoutKey(email) });
}
