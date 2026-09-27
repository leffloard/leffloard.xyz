import { clientIp, ipKey } from "@/lib/ip";
import { normalizeCspReports } from "@/lib/csp-reports";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { readBodyText } from "@/server/http";
import { hitRateLimit } from "@/server/security/rate-limit";

export const dynamic = "force-dynamic";

const MAX_BYTES = 16 * 1024;
const LIMIT = { limit: 60, windowMs: 10 * 60_000 };

// Browsers post Content Security Policy violations here. Answers 204 whatever happens, so a report never
// shows up as an error in the visitor's console; bad, huge or too frequent reports are dropped.
export async function POST(request: Request): Promise<Response> {
  const done = new Response(null, { status: 204 });
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/(csp-report|reports\+json|json)\b/.test(type)) return done;

  const body = await readBodyText(request, MAX_BYTES);
  if (!body) return done;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return done;
  }
  const reports = normalizeCspReports(parsed);
  if (reports.length === 0) return done;

  const db = await getDb();
  const ip = clientIp(request.headers, getEnv().CLIENT_IP_SOURCE);
  const limit = await hitRateLimit(db, `csp:${ipKey(ip) ?? "unknown"}`, LIMIT);
  if (!limit.allowed) return done;

  const receivedAt = now();
  const userAgent = (request.headers.get("user-agent") ?? "").slice(0, 300);
  await db
    .collection("csp_reports")
    .insertMany(reports.map((report) => ({ ...report, receivedAt, userAgent })));
  return done;
}
