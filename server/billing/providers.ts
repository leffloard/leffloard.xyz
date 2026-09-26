import "server-only";
import type { PaymentMethod } from "@/lib/billing/options";
import type { Currency } from "@/lib/money";
import { bankAccountFor } from "@/server/billing/invoices";
import type { BillingSettings } from "@/server/billing/settings";
import { getEnv } from "@/server/env";

// Which ways to pay can be offered on invoices right now. Bank transfer needs an account in the billing
// settings (checked when an invoice is issued); crypto needs NOWPayments' keys; no card provider is connected.
export function paymentsAvailable(): { crypto: boolean; card: boolean } {
  const env = getEnv();
  return { crypto: Boolean(env.NOWPAYMENTS_API_KEY && env.NOWPAYMENTS_IPN_SECRET), card: false };
}

// The ways to pay an invoice in a currency can offer today, out of the ones the owner chose: bank transfer with
// an account that takes the currency, crypto once NOWPayments is set up.
export function payableMethods(
  settings: Pick<BillingSettings, "methods" | "bankAccounts">,
  currency: Currency,
): PaymentMethod[] {
  const available = paymentsAvailable();
  return settings.methods.filter((method) =>
    method === "bank" ? bankAccountFor(settings.bankAccounts, currency) !== null : available[method],
  );
}
