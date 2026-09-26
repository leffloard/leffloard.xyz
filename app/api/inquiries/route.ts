import { MongoError } from "mongodb";
import { parseInquiryForm } from "@/lib/intake/form";
import { honeypotFilled } from "@/lib/intake/legacy";
import { clientIp } from "@/lib/ip";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { jsonResponse, readBodyText } from "@/server/http";
import { triageSoon } from "@/server/ai/kick";
import { INTAKE_LIMIT, intakeLimitKey, submitInquiry } from "@/server/inquiries/intake";
import { log } from "@/server/log";
import { sendQueuedSoon } from "@/server/notify/kick";
import { idempotent, readIdempotencyKey } from "@/server/security/idempotency";
import { hasUnsafeKeys } from "@/server/security/nosql";
import { isSameOriginRequest } from "@/server/security/origin";
import { hitRateLimit } from "@/server/security/rate-limit";
import { verifyTurnstile } from "@/server/security/turnstile";

// The contact form. Answers:
//   201 { ok: true }                         stored (or quietly dropped as spam)
//   422 { error, errors: { field: message } } fix the highlighted fields
//   403 { error, code }                       bot check failed, or a cross-site post
//   429 { error, retryAfter }                 too many messages from this address
// With an Idempotency-Key header, sending the same form twice stores it once.

export const dynamic = "force-dynamic";

const MAX_BYTES = 32 * 1024;

export async function POST(request: Request): Promise<Response> {
  try {
    const env = getEnv();
    if (!isSameOriginRequest(request.headers, env.SITE_URL)) {
      return jsonResponse({ error: "Cross-site posts are not accepted.", code: "origin" }, 403);
    }
    if (!/^application\/json\b/.test(request.headers.get("content-type") ?? "")) {
      return jsonResponse({ error: "Send the form as JSON." }, 415);
    }
    const text = await readBodyText(request, MAX_BYTES);
    if (text === null) return jsonResponse({ error: "The message is too large." }, 413);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return jsonResponse({ error: "The form could not be read." }, 400);
    }
    if (payload === null || typeof payload !== "object" || Array.isArray(payload) || hasUnsafeKeys(payload)) {
      return jsonResponse({ error: "The form could not be read." }, 400);
    }
    const fields = payload as Record<string, unknown>;
    if (honeypotFilled(fields.website)) return jsonResponse({ ok: true }, 201);

    const parsed = parseInquiryForm(fields, now());
    if (!parsed.ok) {
      return jsonResponse({ error: "Check the highlighted fields.", errors: parsed.errors }, 422);
    }

    const db = await getDb();
    const ip = clientIp(request.headers, env.CLIENT_IP_SOURCE);
    const result = await idempotent(db, "inquiry", readIdempotencyKey(request.headers), async () => {
      const limit = await hitRateLimit(db, intakeLimitKey(ip), INTAKE_LIMIT);
      if (!limit.allowed) {
        return {
          status: 429,
          body: {
            error: "Too many messages from your connection. Try again in a few minutes.",
            retryAfter: limit.retryAfterSeconds,
          },
        };
      }
      const token = typeof fields.turnstileToken === "string" ? fields.turnstileToken : null;
      const check = await verifyTurnstile({ token, ip, action: "contact" });
      if (!check.ok) {
        return {
          status: 403,
          body: { error: "The bot check did not pass. Wait a moment and send it again.", code: "turnstile" },
        };
      }
      const inquiry = await submitInquiry(db, parsed.data, { source: "form", siteUrl: env.SITE_URL });
      sendQueuedSoon();
      triageSoon(db, inquiry);
      return { status: 201, body: { ok: true } };
    });
    const retryAfter = (result.body as { retryAfter?: number }).retryAfter;
    return jsonResponse(result.body, result.status, retryAfter ? { "retry-after": String(retryAfter) } : {});
  } catch (error) {
    log.error({ err: error }, "POST /api/inquiries failed");
    const unavailable = error instanceof MongoError;
    return jsonResponse(
      {
        error: unavailable
          ? "The form is temporarily unavailable. Please email me instead."
          : "Something went wrong. Please email me instead.",
      },
      unavailable ? 503 : 500,
    );
  }
}
