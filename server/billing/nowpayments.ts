import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentStatus } from "@/lib/billing/options";
import { decimalAmount, parseDecimalAmount, type Currency } from "@/lib/money";
import { getEnv } from "@/server/env";

// NOWPayments (crypto): its hosted invoice page, payment lookups, and the signature on its payment callbacks
// (IPN). Only a status re-read from the API decides anything; the callback just says when to look.

export type NowPaymentsConfig = { apiUrl: string; apiKey: string; ipnSecret: string };

export function nowPaymentsConfig(): NowPaymentsConfig | null {
  const env = getEnv();
  if (!env.NOWPAYMENTS_API_KEY || !env.NOWPAYMENTS_IPN_SECRET) return null;
  return {
    apiUrl: env.NOWPAYMENTS_API_URL,
    apiKey: env.NOWPAYMENTS_API_KEY,
    ipnSecret: env.NOWPAYMENTS_IPN_SECRET,
  };
}

export class NowPaymentsError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "NowPaymentsError";
  }
}

async function call<T>(config: NowPaymentsConfig, path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}${path}`, {
      ...init,
      headers: { "x-api-key": config.apiKey, "content-type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch (error) {
    throw new NowPaymentsError(`NOWPayments did not answer: ${(error as Error).message}`, null);
  }
  if (!response.ok) {
    // The body may say why; it never holds our secrets, but is cut short for the log.
    const text = (await response.text().catch(() => "")).slice(0, 300);
    throw new NowPaymentsError(`NOWPayments answered ${response.status}: ${text}`, response.status);
  }
  return (await response.json()) as T;
}

export type CheckoutInput = {
  amountMinor: number;
  currency: Currency;
  orderId: string; // "<invoice number>:<our payment id>"
  description: string;
  ipnUrl: string;
  successUrl: string;
  cancelUrl: string;
};

// A hosted payment page for the amount; the client picks the coin there.
export async function createNowPaymentsInvoice(
  config: NowPaymentsConfig,
  input: CheckoutInput,
): Promise<{ id: string; url: string }> {
  const created = await call<{ id?: string | number; invoice_url?: string }>(config, "/invoice", {
    method: "POST",
    body: JSON.stringify({
      // A JSON number written from the exact decimal ("925.00" is sent as 925).
      price_amount: Number(decimalAmount(input.amountMinor)),
      price_currency: input.currency.toLowerCase(),
      order_id: input.orderId,
      order_description: input.description.slice(0, 200),
      ipn_callback_url: input.ipnUrl,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      is_fee_paid_by_user: false,
    }),
  });
  if (created.id === undefined || !created.invoice_url?.startsWith("http")) {
    throw new NowPaymentsError("NOWPayments returned no payment page.", null);
  }
  return { id: String(created.id), url: created.invoice_url };
}

export type NowPayment = {
  payment_id: number | string;
  invoice_id?: number | string | null;
  payment_status: string;
  price_amount: number | string;
  price_currency: string;
  pay_amount?: number | string | null;
  actually_paid?: number | string | null;
  pay_currency?: string | null;
  order_id?: string | null;
};

export async function fetchNowPayment(config: NowPaymentsConfig, paymentId: string): Promise<NowPayment> {
  if (!/^\d{1,20}$/.test(paymentId)) throw new NowPaymentsError("Not a NOWPayments payment id.", null);
  return call<NowPayment>(config, `/payment/${paymentId}`);
}

// What a NOWPayments status means here. Only "finished" is money received; a part payment waits for the owner.
export function mapNowPaymentsStatus(status: string): Exclude<PaymentStatus, "refunded"> | "refunded" | null {
  switch (status) {
    case "waiting":
    case "confirming":
    case "confirmed":
    case "sending":
      return "pending";
    case "finished":
      return "confirmed";
    case "partially_paid":
      return "review";
    case "failed":
    case "expired":
      return "failed";
    case "refunded":
      return "refunded";
    default:
      return null;
  }
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortDeep((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

// The callback's x-nowpayments-sig: HMAC-SHA512 of the body's JSON with sorted keys, under the IPN secret.
// NOWPayments' own samples differ on nested keys (their SDK sorts them too, their docs' sample and plugin sort
// only the top level), so each form is accepted; every one of them needs the secret.
export function ipnSignatureValid(body: unknown, signature: string | null, secret: string): boolean {
  if (
    !signature ||
    !/^[a-f0-9]{128}$/i.test(signature) ||
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return false;
  }
  const record = body as Record<string, unknown>;
  const topSorted = Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key]]),
  );
  const candidates = new Set([
    JSON.stringify(sortDeep(record)),
    JSON.stringify(topSorted),
    JSON.stringify(record, Object.keys(record).sort()),
  ]);
  const given = Buffer.from(signature.toLowerCase(), "hex");
  let valid = false;
  for (const candidate of candidates) {
    const expected = Buffer.from(createHmac("sha512", secret).update(candidate).digest("hex"), "hex");
    if (expected.length === given.length && timingSafeEqual(expected, given)) valid = true;
  }
  return valid;
}

// Amounts come as JSON numbers or strings of major units; compared in minor units, read exactly (an amount
// with fractions of a cent is not one we asked for).
export function minorUnits(value: number | string | null | undefined): number | null {
  return parseDecimalAmount(value);
}
