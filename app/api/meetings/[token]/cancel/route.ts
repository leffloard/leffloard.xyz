import { cleanText } from "@/lib/intake/text";
import { clientIp } from "@/lib/ip";
import { guestCancel, PROBLEM_MESSAGES } from "@/server/calendar/booking";
import { findMeetingByToken } from "@/server/calendar/meetings";
import { limited, MANAGE_LIMIT, notifyContext } from "@/server/calendar/public";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { jsonResponse, readJsonPost } from "@/server/http";
import { log } from "@/server/log";
import { sendQueuedSoon } from "@/server/notify/kick";

// A guest cancels their meeting through their link, with an optional reason.
//   200 { ok }
//   409 { error, problem }   it has already ended or been cancelled
//   404 { error }            the link is not valid

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  try {
    const env = getEnv();
    const body = await readJsonPost(request, { siteUrl: env.SITE_URL, maxBytes: 4096 });
    if (!body.ok) return body.response;
    const db = await getDb();
    const tooMany = await limited(
      db,
      "manage",
      clientIp(request.headers, env.CLIENT_IP_SOURCE),
      MANAGE_LIMIT,
    );
    if (tooMany) return tooMany;
    const meeting = await findMeetingByToken(db, (await params).token);
    if (!meeting) return jsonResponse({ error: "This link is not valid." }, 404);
    const reason = cleanText(body.fields.reason, { maxLength: 500, multiline: true });
    if (!reason.ok) return jsonResponse({ error: reason.message, errors: { reason: reason.message } }, 422);

    const cancelled = await guestCancel(db, meeting, reason.value, notifyContext());
    if (!cancelled) return jsonResponse({ error: PROBLEM_MESSAGES.gone, problem: "gone" }, 409);
    sendQueuedSoon();
    return jsonResponse({ ok: true });
  } catch (error) {
    log.error({ err: error }, "POST /api/meetings/[token]/cancel failed");
    return jsonResponse({ error: "This is temporarily unavailable. Please email me instead." }, 503);
  }
}
