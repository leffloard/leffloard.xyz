import { ADMIN_TIME_ZONE } from "@/lib/format";
import { cleanText } from "@/lib/intake/text";
import { todayIn } from "@/lib/intake/time";
import { clientIp } from "@/lib/ip";
import { alertQuoteAnswer } from "@/server/billing/notify";
import { PUBLIC_ID_PATTERN } from "@/server/billing/public-id";
import { ANSWER_LIMIT, ANSWER_MESSAGES } from "@/server/billing/public";
import { declineQuote } from "@/server/billing/quotes";
import { limited, notifyContext } from "@/server/calendar/public";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { jsonResponse, readJsonPost } from "@/server/http";
import { log } from "@/server/log";
import { sendQueuedSoon } from "@/server/notify/kick";

// The client declines a quote from its link: { version, reason? }.
//   200 { ok }
//   409 { error, problem }
//   422 { error, errors }
//   404 { error }

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ publicId: string }> },
): Promise<Response> {
  try {
    const env = getEnv();
    const body = await readJsonPost(request, { siteUrl: env.SITE_URL, maxBytes: 4096 });
    if (!body.ok) return body.response;
    const db = await getDb();
    const tooMany = await limited(db, "quote", clientIp(request.headers, env.CLIENT_IP_SOURCE), ANSWER_LIMIT);
    if (tooMany) return tooMany;
    const publicId = (await params).publicId;
    if (!PUBLIC_ID_PATTERN.test(publicId)) return jsonResponse({ error: ANSWER_MESSAGES.missing }, 404);
    const { version } = body.fields;
    if (typeof version !== "number" || !Number.isInteger(version)) {
      return jsonResponse(
        { error: "Reload the page and try again.", errors: { form: "Reload the page." } },
        422,
      );
    }
    const reason = cleanText(body.fields.reason, { maxLength: 1000, multiline: true });
    if (!reason.ok) return jsonResponse({ error: reason.message, errors: { reason: reason.message } }, 422);

    const at = now();
    const declined = await declineQuote(
      db,
      publicId,
      version,
      reason.value,
      todayIn(ADMIN_TIME_ZONE, at),
      at,
    );
    if (!declined.ok) {
      const status = declined.problem === "missing" ? 404 : 409;
      return jsonResponse({ error: ANSWER_MESSAGES[declined.problem], problem: declined.problem }, status);
    }
    await alertQuoteAnswer(db, declined.quote, "declined", notifyContext());
    sendQueuedSoon();
    return jsonResponse({ ok: true });
  } catch (error) {
    log.error({ err: error }, "POST /api/quotes/[publicId]/decline failed");
    return jsonResponse(
      { error: "This is temporarily unavailable. Please reply to the quote's email instead." },
      503,
    );
  }
}
