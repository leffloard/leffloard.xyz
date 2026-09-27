import { analyticsPayload } from "@/lib/analytics/clean";
import { ANALYTICS_DAILY_CAP, ANALYTICS_LIMIT } from "@/lib/analytics/model";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { todayIn } from "@/lib/intake/time";
import { clientIp, ipKey } from "@/lib/ip";
import { recordView, recordVitals, untracked } from "@/server/analytics/record";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { readBodyText } from "@/server/http";
import { log } from "@/server/log";
import { DailyCap, MemoryLimiter } from "@/server/security/memory-limit";
import { hasUnsafeKeys } from "@/server/security/nosql";
import { isSameOriginRequest } from "@/server/security/origin";

export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024;
const limiter = new MemoryLimiter(ANALYTICS_LIMIT.limit, ANALYTICS_LIMIT.windowMs);
const dailyCap = new DailyCap(ANALYTICS_DAILY_CAP);

// The public site's tracker (components/site/analytics.tsx) posts page views and loading timings here.
// Always answers 204, so nothing shows up in a visitor's console: what isn't counted is dropped quietly.
export async function POST(request: Request): Promise<Response> {
  const done = new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  try {
    const env = getEnv();
    if (!isSameOriginRequest(request.headers, env.SITE_URL)) return done;
    if (!/^application\/json\b/.test(request.headers.get("content-type") ?? "")) return done;
    if (untracked(request.headers)) return done;
    const text = await readBodyText(request, MAX_BYTES);
    if (!text) return done;
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return done;
    }
    if (body === null || typeof body !== "object" || hasUnsafeKeys(body)) return done;
    const parsed = analyticsPayload.safeParse(body);
    if (!parsed.success) return done;
    const ip = clientIp(request.headers, env.CLIENT_IP_SOURCE);
    const at = now();
    if (!limiter.hit(ipKey(ip) ?? "unknown", at.getTime())) return done;
    const allowance = dailyCap.take(todayIn(ADMIN_TIME_ZONE, at));
    if (allowance !== "allowed") {
      if (allowance === "just-full") {
        log.warn(
          { limit: ANALYTICS_DAILY_CAP },
          "visitor statistics: today's limit is reached; the rest aren't kept",
        );
      }
      return done;
    }

    const db = await getDb();
    if (parsed.data.type === "view") {
      await recordView(db, request.headers, parsed.data, {
        siteUrl: env.SITE_URL,
        ipSource: env.CLIENT_IP_SOURCE,
      });
    } else {
      await recordVitals(db, parsed.data);
    }
  } catch (error) {
    log.warn({ err: error }, "recording a visit failed");
  }
  return done;
}
