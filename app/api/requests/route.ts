import { randomUUID } from "node:crypto";
import { MongoError } from "mongodb";
import {
  BODY_NOT_JSON,
  BODY_NOT_OBJECT,
  honeypotFilled,
  legacyToInquiryInput,
  parseLegacyRequest,
  type FieldError,
} from "@/lib/intake/legacy";
import { clientIp } from "@/lib/ip";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { jsonResponse, readBodyText } from "@/server/http";
import { triageSoon } from "@/server/ai/kick";
import { goalSoon } from "@/server/analytics/kick";
import { INTAKE_LIMIT, intakeLimitKey, submitInquiry } from "@/server/inquiries/intake";
import { log } from "@/server/log";
import { sendQueuedSoon } from "@/server/notify/kick";
import { isSameOriginRequest } from "@/server/security/origin";
import { hitRateLimit } from "@/server/security/rate-limit";

// The v1 request form's endpoint, with the v1 contract: 201 {id, status, created_at}, 422 {detail: [{field,
// message}]}, 429 with Retry-After. Kept for pages and scripts written against v1; new visitors use the
// contact form (/api/inquiries). Messages land in the same inbox.

export const dynamic = "force-dynamic";

const MAX_BYTES = 64 * 1024;

function isoWithOffset(at: Date): string {
  return at.toISOString().replace("Z", "+00:00");
}

function created(id: string, at: Date): Response {
  return jsonResponse({ id, status: "new", created_at: isoWithOffset(at) }, 201);
}

function invalid(errors: FieldError[]): Response {
  return jsonResponse({ detail: errors }, 422);
}

export async function POST(request: Request): Promise<Response> {
  try {
    const env = getEnv();
    if (!isSameOriginRequest(request.headers, env.SITE_URL)) {
      return jsonResponse({ detail: "Cross-site requests are not accepted." }, 403);
    }
    const text = await readBodyText(request, MAX_BYTES);
    if (text === null) return jsonResponse({ detail: "The request body is too large." }, 413);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return invalid([BODY_NOT_JSON]);
    }
    if (payload === null || typeof payload !== "object" || Array.isArray(payload))
      return invalid([BODY_NOT_OBJECT]);
    const fields = payload as Record<string, unknown>;

    // Bots get the answer they expect and nothing is stored or sent.
    if (honeypotFilled(fields.website)) return created(randomUUID(), now());

    const parsed = parseLegacyRequest(fields, now());
    if (!parsed.ok) return invalid(parsed.errors);

    const db = await getDb();
    const ip = clientIp(request.headers, env.CLIENT_IP_SOURCE);
    const limit = await hitRateLimit(db, intakeLimitKey(ip), INTAKE_LIMIT);
    if (!limit.allowed) {
      return jsonResponse({ detail: "Too many requests. Please try again later." }, 429, {
        "retry-after": String(limit.retryAfterSeconds),
      });
    }

    const inquiry = await submitInquiry(db, legacyToInquiryInput(parsed.data), {
      source: "legacy-api",
      siteUrl: env.SITE_URL,
    });
    sendQueuedSoon();
    triageSoon(db, inquiry);
    if (inquiry.status !== "spam") goalSoon(request.headers, "inquiry");
    return created(inquiry.publicId, inquiry.receivedAt);
  } catch (error) {
    if (error instanceof MongoError) {
      log.error({ err: error }, "database error in POST /api/requests");
      return jsonResponse({ detail: "The service is temporarily unavailable. Please try again later." }, 503);
    }
    log.error({ err: error }, "POST /api/requests failed");
    return jsonResponse({ detail: "Internal server error." }, 500);
  }
}
