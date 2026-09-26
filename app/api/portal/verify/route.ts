import { cookies } from "next/headers";
import { clientIp } from "@/lib/ip";
import { cookieName, cookieOptions } from "@/server/auth/cookies";
import { limited } from "@/server/calendar/public";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { jsonResponse, readJsonPost } from "@/server/http";
import { log } from "@/server/log";
import { PORTAL_MAX_MS, signInWithLink } from "@/server/portal/access";
import { PORTAL_MAX_BYTES, VERIFY_LIMIT } from "@/server/portal/public";

// Signs in with a link: the link's page posts its token here, so only a person pressing the button spends it.
//   200 { ok }   410 used or expired   429 too many   503 unavailable

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const env = getEnv();
    const body = await readJsonPost(request, { siteUrl: env.SITE_URL, maxBytes: PORTAL_MAX_BYTES });
    if (!body.ok) return body.response;
    const db = await getDb();
    const ip = clientIp(request.headers, env.CLIENT_IP_SOURCE);
    const tooMany = await limited(db, "portal-verify", ip, VERIFY_LIMIT);
    if (tooMany) return tooMany;
    const token = typeof body.fields.token === "string" ? body.fields.token : "";
    const signedIn = await signInWithLink(db, token, {
      ip,
      userAgent: request.headers.get("user-agent") ?? "",
    });
    if (!signedIn) {
      return jsonResponse({ error: "This link has expired or was already used. Ask for a new one." }, 410);
    }
    (await cookies()).set(
      cookieName("portal"),
      signedIn.token,
      cookieOptions("portal", PORTAL_MAX_MS / 1000),
    );
    return jsonResponse({ ok: true });
  } catch (error) {
    log.error({ err: error }, "POST /api/portal/verify failed");
    return jsonResponse({ error: "This is temporarily unavailable. Please try again later." }, 503);
  }
}
