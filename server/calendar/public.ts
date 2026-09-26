import "server-only";
import type { Db } from "mongodb";
import { ipKey } from "@/lib/ip";
import { getEnv } from "@/server/env";
import type { NotifyContext } from "@/server/calendar/booking";
import { jsonResponse } from "@/server/http";
import { readChannels } from "@/server/notify/channels";
import { hitRateLimit, type RateLimit } from "@/server/security/rate-limit";

// Shared by the public booking endpoints.

// Five bookings, and twenty changes through manage links, per address every ten minutes.
export const BOOKING_LIMIT: RateLimit = { limit: 5, windowMs: 10 * 60_000 };
export const MANAGE_LIMIT: RateLimit = { limit: 20, windowMs: 10 * 60_000 };
// Slot lists are read often while someone picks a time.
export const SLOTS_LIMIT: RateLimit = { limit: 60, windowMs: 60_000 };

export function notifyContext(): NotifyContext {
  return { siteUrl: getEnv().SITE_URL, channels: readChannels() };
}

// A 429 answer when the address used up the limit, or null.
export async function limited(db: Db, scope: string, ip: string, limit: RateLimit): Promise<Response | null> {
  const result = await hitRateLimit(db, `${scope}:${ipKey(ip) ?? "unknown"}`, limit);
  if (result.allowed) return null;
  return jsonResponse(
    {
      error: "Too many requests from your connection. Try again in a few minutes.",
      retryAfter: result.retryAfterSeconds,
    },
    429,
    { "retry-after": String(result.retryAfterSeconds) },
  );
}

export function slotList(slots: Date[]): string[] {
  return slots.map((slot) => slot.toISOString());
}
