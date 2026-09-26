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
import type { Channels } from "@/server/notify/channels";
import { enqueue } from "@/server/notify/outbox";

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
  const key = `quote:${quote._id.toHexString()}:owner-${answer}`;
  const label = `Quote ${answer}: ${quote.number}`;
  if (notify.channels.ownerEmail) {
    await enqueue(db, {
      channel: "email",
      payload: quoteAnswerEmail(quote, answer, { to: notify.channels.ownerEmail, siteUrl: notify.siteUrl }),
      dedupeKey: `${key}:email`,
      label,
      ref: { quoteId: quote._id },
    });
  }
  if (notify.channels.discordWebhookUrl) {
    await enqueue(db, {
      channel: "discord",
      payload: quoteAnswerDiscord(quote, answer, notify.siteUrl),
      dedupeKey: `${key}:discord`,
      label,
      ref: { quoteId: quote._id },
    });
  }
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
  const key = `payment:${payment._id.toHexString()}:owner-${event}`;
  const label =
    event === "received" ? `Payment received: ${invoice.number}` : `Payment to review: ${invoice.number}`;
  if (notify.channels.ownerEmail) {
    await enqueue(db, {
      channel: "email",
      payload: paymentAlertEmail(invoice, payment, event, {
        to: notify.channels.ownerEmail,
        siteUrl: notify.siteUrl,
      }),
      dedupeKey: `${key}:email`,
      label,
      ref: { invoiceId: invoice._id },
    });
  }
  if (notify.channels.discordWebhookUrl) {
    await enqueue(db, {
      channel: "discord",
      payload: paymentAlertDiscord(invoice, payment, event, notify.siteUrl),
      dedupeKey: `${key}:discord`,
      label,
      ref: { invoiceId: invoice._id },
    });
  }
}

// A recurring invoice that couldn't be issued: once per plan and date.
export async function alertRecurringProblem(
  db: Db,
  plan: RecurringInvoiceDoc,
  problem: string,
  notify: BillingNotify,
): Promise<void> {
  const key = `recurring:${plan._id.toHexString()}:${plan.nextOn ?? "none"}:problem`;
  const label = `Recurring invoice not issued: ${plan.title}`;
  if (notify.channels.ownerEmail) {
    await enqueue(db, {
      channel: "email",
      payload: recurringProblemEmail(plan, problem, {
        to: notify.channels.ownerEmail,
        siteUrl: notify.siteUrl,
      }),
      dedupeKey: `${key}:email`,
      label,
    });
  }
  if (notify.channels.discordWebhookUrl) {
    await enqueue(db, {
      channel: "discord",
      payload: recurringProblemDiscord(plan, problem, notify.siteUrl),
      dedupeKey: `${key}:discord`,
      label,
    });
  }
}
