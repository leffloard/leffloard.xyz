import { cookies } from "next/headers";
import { cookieName } from "@/server/auth/cookies";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { jsonResponse, readJsonPost } from "@/server/http";
import { log } from "@/server/log";
import { endClientSessions, endPortalSession } from "@/server/portal/access";
import { currentPortalClient } from "@/server/portal/dal";

// Signs out here, or everywhere ({ everywhere: true }: every browser, and every link not used yet).

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonPost(request, { siteUrl: getEnv().SITE_URL, maxBytes: 1024 });
    if (!body.ok) return body.response;
    const store = await cookies();
    const token = store.get(cookieName("portal"))?.value;
    const db = await getDb();
    if (body.fields.everywhere === true) {
      const context = await currentPortalClient();
      if (context) await endClientSessions(db, context.client._id);
    }
    await endPortalSession(db, token);
    store.delete(cookieName("portal"));
    return jsonResponse({ ok: true });
  } catch (error) {
    log.error({ err: error }, "POST /api/portal/logout failed");
    return jsonResponse({ error: "This is temporarily unavailable. Please try again later." }, 503);
  }
}
