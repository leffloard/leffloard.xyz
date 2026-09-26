import { clientIp } from "@/lib/ip";
import { invoiceByPublicId } from "@/server/billing/invoices";
import { createNowPaymentsInvoice, nowPaymentsConfig } from "@/server/billing/nowpayments";
import { openCryptoAttempt, setCheckout } from "@/server/billing/payments";
import { CHECKOUT_LIMIT } from "@/server/billing/public";
import { PUBLIC_ID_PATTERN } from "@/server/billing/public-id";
import { payments } from "@/server/billing/collections";
import { limited } from "@/server/calendar/public";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { jsonResponse, readJsonPost } from "@/server/http";
import { log } from "@/server/log";

// The client starts paying an invoice in cryptocurrency: a NOWPayments payment page for what's left to pay,
// reused while it's open, so repeated clicks don't open several.
//   200 { url }   the payment page to go to
//   409 { error } not payable this way (paid, void, crypto not offered), or a page is still being prepared
//   502 { error } NOWPayments is unavailable: pay by bank transfer instead

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ publicId: string }> },
): Promise<Response> {
  try {
    const env = getEnv();
    const body = await readJsonPost(request, { siteUrl: env.SITE_URL, maxBytes: 1024 });
    if (!body.ok) return body.response;
    const db = await getDb();
    const tooMany = await limited(
      db,
      "checkout",
      clientIp(request.headers, env.CLIENT_IP_SOURCE),
      CHECKOUT_LIMIT,
    );
    if (tooMany) return tooMany;
    const publicId = (await params).publicId;
    const invoice = PUBLIC_ID_PATTERN.test(publicId) ? await invoiceByPublicId(db, publicId) : null;
    if (!invoice) return jsonResponse({ error: "This link doesn't work." }, 404);
    const config = nowPaymentsConfig();
    if (
      invoice.status !== "issued" ||
      invoice.kind !== "invoice" ||
      !invoice.methods.includes("crypto") ||
      !config
    ) {
      return jsonResponse({ error: "This can't be paid in cryptocurrency. Please use bank transfer." }, 409);
    }

    const at = now();
    const { payment, fresh } = await openCryptoAttempt(db, invoice, at);
    if (payment.provider?.url) return jsonResponse({ url: payment.provider.url });
    if (!fresh) {
      return jsonResponse({ error: "The payment page is being prepared. Try again in a moment." }, 409);
    }
    try {
      const checkout = await createNowPaymentsInvoice(config, {
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        orderId: `${invoice.number}:${payment._id.toHexString()}`,
        description: `${invoice.number}: ${invoice.title}`,
        ipnUrl: `${env.SITE_URL}/api/payments/nowpayments`,
        successUrl: `${env.SITE_URL}/pay/return?i=${invoice.publicId}`,
        cancelUrl: `${env.SITE_URL}/i/${invoice.publicId}`,
      });
      await setCheckout(db, payment._id, { invoiceId: checkout.id, url: checkout.url }, at);
      return jsonResponse({ url: checkout.url });
    } catch (error) {
      log.error({ err: error, invoice: invoice.number }, "NOWPayments checkout failed");
      await payments(db).updateOne(
        { _id: payment._id, status: "pending" },
        { $set: { status: "failed", reviewReason: "The payment page could not be made.", updatedAt: at } },
      );
      return jsonResponse(
        { error: "Crypto payment is unavailable right now. Please pay by bank transfer." },
        502,
      );
    }
  } catch (error) {
    log.error({ err: error }, "POST /api/invoices/[publicId]/checkout failed");
    return jsonResponse({ error: "This is temporarily unavailable. Please try again later." }, 503);
  }
}
