import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { MongoServerError, type Db } from "mongodb";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { addDays, zonedInstant } from "@/lib/intake/time";
import { analyticsSalts } from "@/server/analytics/collections";

// A visitor is counted by a hash of the day's salt, their address, their browser and the site's host: the
// same person is one visitor within a day and a stranger the next. The salt is random, made by the first
// visit of the day and shared by every process through the database, and deleted an hour after its day
// ends (a TTL index), after which a visitor id can't be linked to an address any more. It is not backed up.

const cache = new Map<string, string>();

export async function daySalt(db: Db, day: string, at: Date): Promise<string> {
  const cached = cache.get(day);
  if (cached) return cached;
  const end = zonedInstant(addDays(day, 1), "00:00", ADMIN_TIME_ZONE) ?? at;
  const expiresAt = new Date(Math.max(end.getTime(), at.getTime()) + 3_600_000);
  let salt: string | undefined;
  try {
    const doc = await analyticsSalts(db).findOneAndUpdate(
      { _id: day },
      { $setOnInsert: { salt: randomBytes(32).toString("base64"), expiresAt } },
      { upsert: true, returnDocument: "after" },
    );
    salt = doc?.salt;
  } catch (error) {
    // Two processes made the day's salt at the same moment: the one that was stored is used.
    if (!(error instanceof MongoServerError && error.code === 11000)) throw error;
  }
  salt ??= (await analyticsSalts(db).findOne({ _id: day }))?.salt;
  if (!salt) throw new Error(`The visitor statistics have no salt for ${day}.`);
  // Only today's salt is kept in memory.
  cache.clear();
  cache.set(day, salt);
  return salt;
}

export function forgetSalts(): void {
  cache.clear();
}

export function visitorId(salt: string, parts: { ip: string; userAgent: string; host: string }): string {
  return createHash("sha256")
    .update([salt, parts.ip, parts.userAgent, parts.host].join("\n"))
    .digest("base64url")
    .slice(0, 22);
}
