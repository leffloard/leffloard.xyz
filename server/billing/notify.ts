import "server-only";
import type { Db } from "mongodb";
import {
  invoiceEmail,
  paymentAlertDiscord,
  paymentAlertEmail,
  receiptEmail,
  type PaymentEvent,
  quoteAnswerDiscord,
  quoteAnswerEmail,
  quoteEmail,
  recurringProblemDiscord,
  recurringProblemEmail,
  type BillingMailContext,
  type QuoteAnswer,
} from "@/server/billing/emails";
import { getBillingSettings } from "@/server/billing/settings";
import type { InvoiceDoc, PaymentDoc, QuoteDoc, RecurringInvoiceDoc } from "@/server/billing/types";
import { formatMoney, money } from "@/lib/money";
import type { Channels } from "@/server/notify/channels";
import { enqueue } from "@/server/notify/outbox";
import { alertOwner } from "@/server/notify/owner";

// Billing messages go through the outbox like every other: stored first under a dedupeKey, then sent.

export type BillingNotify = { siteUrl: string; channels: Channels };

async function mailContext(db: Db, notify: BillingNotify): Promise<BillingMailContext> {
  const settings = await getBillingSettings(db);
  return { siteUrl: notify.siteUrl, ownerEmail: notify.channels.ownerEmail, seller: settings.business };
}

// The quote's link to the client. False when email is off or the quote has no address.
export async function emailQuote(db: Db, quote: QuoteDoc, notify: BillingNotify, at: Date): Promise<boolean> {
  if (!notify.channels.email || !quote.recipient.email) return false;
  await enqueue(db, {
    channel: "email",
    payload: quoteEmail(quote, await mailContext(db, notify)),
    // A quote sent again after a change is a new email; a double click is not.
    dedupeKey: `quote:${quote._id.toHexString()}:sent:${quote.version}:${Math.floor(at.getTime() / 60_000)}`,
    label: `Quote ${quote.number} to ${quote.recipient.name}`,
    ref: { quoteId: quote._id },
  });
  return true;
}

export async function emailInvoice(
  db: Db,
  invoice: InvoiceDoc,
  notify: BillingNotify,
  { again, at }: { again: boolean; at: Date },
): Promise<boolean> {
  if (!notify.channels.email || !invoice.recipient.email || invoice.kind !== "invoice") return false;
  const id = invoice._id.toHexString();
  await enqueue(db, {
    channel: "email",
    payload: invoiceEmail(invoice, await mailContext(db, notify), again),
    dedupeKey: again ? `invoice:${id}:again:${Math.floor(at.getTime() / 60_000)}` : `invoice:${id}:issued`,
    label: `${invoice.label ?? "Invoice"} ${invoice.number} to ${invoice.recipient.name}`,
    ref: { invoiceId: invoice._id },
  });
  return true;
}

export async function alertQuoteAnswer(
  db: Db,
  quote: QuoteDoc,
  answer: QuoteAnswer,
  notify: BillingNotify,
): Promise<void> {
  await alertOwner(db, notify.channels, {
    kind: "quote",
    key: `quote:${quote._id.toHexString()}:owner-${answer}`,
    label: `Quote ${answer}: ${quote.number}`,
    title: `Quote ${answer}: ${quote.number}`,
    body: `${quote.recipient.name}: ${quote.title}`,
    href: `/admin/billing/quotes/${quote._id.toHexString()}`,
    ref: { quoteId: quote._id },
    email: (to) => quoteAnswerEmail(quote, answer, { to, siteUrl: notify.siteUrl }),
    discord: () => quoteAnswerDiscord(quote, answer, notify.siteUrl),
  });
}

// The client's receipt for a payment that arrived.
export async function emailReceipt(
  db: Db,
  invoice: InvoiceDoc,
  payment: PaymentDoc,
  notify: BillingNotify,
): Promise<boolean> {
  if (!notify.channels.email || !invoice.recipient.email) return false;
  await enqueue(db, {
    channel: "email",
    payload: receiptEmail(invoice, payment, await mailContext(db, notify)),
    dedupeKey: `payment:${payment._id.toHexString()}:receipt`,
    label: `Receipt for ${invoice.number} to ${invoice.recipient.name}`,
    ref: { invoiceId: invoice._id },
  });
  return true;
}

export async function alertPayment(
  db: Db,
  invoice: InvoiceDoc,
  payment: PaymentDoc,
  event: PaymentEvent,
  notify: BillingNotify,
): Promise<void> {
  const label =
    event === "received" ? `Payment received: ${invoice.number}` : `Payment to review: ${invoice.number}`;
  await alertOwner(db, notify.channels, {
    kind: "payment",
    key: `payment:${payment._id.toHexString()}:owner-${event}`,
    label,
    title: label,
    body: `${formatMoney(money(payment.amountMinor, payment.currency))} from ${invoice.recipient.name}${
      event === "review" && payment.reviewReason ? `: ${payment.reviewReason}` : ""
    }`,
    href: `/admin/billing/invoices/${invoice._id.toHexString()}`,
    ref: { invoiceId: invoice._id },
    email: (to) => paymentAlertEmail(invoice, payment, event, { to, siteUrl: notify.siteUrl }),
    discord: () => paymentAlertDiscord(invoice, payment, event, notify.siteUrl),
  });
}

// A recurring invoice that couldn't be issued: once per plan and date.
export async function alertRecurringProblem(
  db: Db,
  plan: RecurringInvoiceDoc,
  problem: string,
  notify: BillingNotify,
): Promise<void> {
  await alertOwner(db, notify.channels, {
    kind: "problem",
    key: `recurring:${plan._id.toHexString()}:${plan.nextOn ?? "none"}:problem`,
    label: `Recurring invoice not issued: ${plan.title}`,
    title: `Recurring invoice not issued: ${plan.title}`,
    body: problem,
    href: `/admin/billing/recurring/${plan._id.toHexString()}`,
    email: (to) => recurringProblemEmail(plan, problem, { to, siteUrl: notify.siteUrl }),
    discord: () => recurringProblemDiscord(plan, problem, notify.siteUrl),
  });
}
