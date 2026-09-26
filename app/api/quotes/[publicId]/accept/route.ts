import { ADMIN_TIME_ZONE } from "@/lib/format";
import { cleanText } from "@/lib/intake/text";
import { todayIn } from "@/lib/intake/time";
import { clientIp } from "@/lib/ip";
import { alertQuoteAnswer, emailInvoice } from "@/server/billing/notify";
import { payableMethods } from "@/server/billing/providers";
import { PUBLIC_ID_PATTERN } from "@/server/billing/public-id";
import { ANSWER_LIMIT, ANSWER_MESSAGES } from "@/server/billing/public";
import { acceptQuote, quoteByPublicId } from "@/server/billing/quotes";
import { getBillingSettings } from "@/server/billing/settings";
import { limited, notifyContext } from "@/server/calendar/public";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { jsonResponse, readJsonPost } from "@/server/http";
import { log } from "@/server/log";
import { sendQueuedSoon } from "@/server/notify/kick";

// The client accepts a quote from its link: { version, name, agree: true }.
//   200 { ok, invoiceUrl }   accepted; the first payment's invoice is at invoiceUrl
//   409 { error, problem }   changed since it was opened, expired, or already answered
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
    const ip = clientIp(request.headers, env.CLIENT_IP_SOURCE);
    const tooMany = await limited(db, "quote", ip, ANSWER_LIMIT);
    if (tooMany) return tooMany;
    const publicId = (await params).publicId;
    if (!PUBLIC_ID_PATTERN.test(publicId)) return jsonResponse({ error: ANSWER_MESSAGES.missing }, 404);

    const { version, agree } = body.fields;
    const name = cleanText(body.fields.name, {
      maxLength: 100,
      required: true,
      requiredMessage: "Type your name.",
    });
    const errors: Record<string, string> = {};
    if (!name.ok) errors.name = name.message;
    if (agree !== true) errors.agree = "Tick the box to accept the quote and its terms.";
    if (typeof version !== "number" || !Number.isInteger(version))
      errors.form = "Reload the page and try again.";
    if (Object.keys(errors).length)
      return jsonResponse({ error: "Check the highlighted fields.", errors }, 422);

    const at = now();
    const settings = await getBillingSettings(db);
    // The first invoice offers only the ways to pay that work today.
    const quote = await quoteByPublicId(db, publicId);
    const methods = quote ? payableMethods(settings, quote.currency) : settings.methods;
    const accepted = await acceptQuote(
      db,
      publicId,
      version as number,
      { name: name.ok ? name.value! : "", ip },
      { ...settings, methods },
      todayIn(ADMIN_TIME_ZONE, at),
      at,
    );
    if (!accepted.ok) {
      const status = accepted.problem === "missing" ? 404 : 409;
      return jsonResponse({ error: ANSWER_MESSAGES[accepted.problem], problem: accepted.problem }, status);
    }
    const notify = notifyContext();
    await alertQuoteAnswer(db, accepted.quote, "accepted", notify);
    if (accepted.invoice) await emailInvoice(db, accepted.invoice, notify, { again: false, at });
    sendQueuedSoon();
    return jsonResponse({
      ok: true,
      invoiceUrl: accepted.invoice ? `/i/${accepted.invoice.publicId}` : null,
    });
  } catch (error) {
    log.error({ err: error }, "POST /api/quotes/[publicId]/accept failed");
    return jsonResponse(
      { error: "This is temporarily unavailable. Please reply to the quote's email instead." },
      503,
    );
  }
}
