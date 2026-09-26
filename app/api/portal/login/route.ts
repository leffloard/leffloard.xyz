import { after } from "next/server";
import { clientIp, ipKey } from "@/lib/ip";
import { honeypotFilled } from "@/lib/intake/legacy";
import { signInSchema } from "@/lib/portal/forms";
import { limited, notifyContext } from "@/server/calendar/public";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { jsonResponse, readJsonPost } from "@/server/http";
import { log } from "@/server/log";
import { drainOutbox } from "@/server/notify/outbox";
import { fieldErrors } from "@/server/portal/endpoint";
import { PORTAL_MAX_BYTES, SIGN_IN_EMAIL_LIMIT, SIGN_IN_LIMIT } from "@/server/portal/public";
import { requestSignInLink } from "@/server/portal/service";
import { hitRateLimit } from "@/server/security/rate-limit";
import { verifyTurnstile } from "@/server/security/turnstile";

// A client asks for a sign-in link. The answer is the same whether or not the address has a portal.
//   200 { ok }   422 { errors }   403 bot check   429 too many   503 unavailable

export const dynamic = "force-dynamic";

const SENT = { ok: true, message: "If that address has a portal, a sign-in link is on its way." };

export async function POST(request: Request): Promise<Response> {
  try {
    const env = getEnv();
    const body = await readJsonPost(request, { siteUrl: env.SITE_URL, maxBytes: PORTAL_MAX_BYTES });
    if (!body.ok) return body.response;
    if (honeypotFilled(body.fields.website)) return jsonResponse(SENT);
    const db = await getDb();
    const ip = clientIp(request.headers, env.CLIENT_IP_SOURCE);
    const tooMany = await limited(db, "portal-sign-in", ip, SIGN_IN_LIMIT);
    if (tooMany) return tooMany;
    const parsed = signInSchema.safeParse({ email: body.fields.email ?? "" });
    if (!parsed.success) {
      return jsonResponse(
        { error: "Check the highlighted fields.", errors: fieldErrors(parsed.error.issues) },
        422,
      );
    }
    const token = typeof body.fields.turnstileToken === "string" ? body.fields.turnstileToken : null;
    const check = await verifyTurnstile({ token, ip, action: "portal" });
    if (!check.ok) {
      return jsonResponse(
        { error: "The bot check did not pass. Wait a moment and try again.", code: "turnstile" },
        403,
      );
    }
    // The links are made and sent after the answer has gone out, so it comes as fast whether or not the
    // address has a portal. A few links an hour to one address, however many connections ask: the rest are
    // quietly not sent.
    const email = parsed.data.email!;
    after(async () => {
      try {
        const perEmail = await hitRateLimit(db, `portal-email:${email.toLowerCase()}`, SIGN_IN_EMAIL_LIMIT);
        if (!perEmail.allowed) {
          log.warn({ ip: ipKey(ip) }, "portal sign-in links: limit for one address reached");
          return;
        }
        await requestSignInLink(db, email, notifyContext());
        await drainOutbox(db);
      } catch (error) {
        log.error({ err: error }, "portal sign-in links failed");
      }
    });
    return jsonResponse(SENT);
  } catch (error) {
    log.error({ err: error }, "POST /api/portal/login failed");
    return jsonResponse({ error: "This is temporarily unavailable. Please try again later." }, 503);
  }
}
