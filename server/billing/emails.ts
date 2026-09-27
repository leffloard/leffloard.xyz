import "server-only";
import { amountLeft, formatPercent, scheduleAmounts } from "@/lib/billing/document";
import { formatMoney, money } from "@/lib/money";
import { longDate } from "@/server/billing/view";
import type {
  BusinessProfile,
  InvoiceDoc,
  PaymentDoc,
  QuoteDoc,
  RecurringInvoiceDoc,
} from "@/server/billing/types";
import { discordSafe, headerText } from "@/server/notify/escape";
import type { DiscordPayload, EmailMessage, Mailbox } from "@/server/notify/templates";

// What billing emails and alerts say. Documents are linked, not attached: the client's page shows the
// current state (paid, void) and offers the PDF and the ways to pay.

export type BillingMailContext = { siteUrl: string; ownerEmail: string | null; seller: BusinessProfile };

function to(document: QuoteDoc | InvoiceDoc): Mailbox[] {
  return document.recipient.email
    ? [{ name: headerText(document.recipient.name), address: document.recipient.email }]
    : [];
}

function signature(context: BillingMailContext): string[] {
  return ["", "Best regards,", context.seller.name, context.siteUrl];
}

function message(
  document: QuoteDoc | InvoiceDoc,
  context: BillingMailContext,
  subject: string,
  body: string[],
): EmailMessage {
  const lines = [`Hi ${document.recipient.name},`, "", ...body, ...signature(context)];
  return {
    to: to(document),
    replyTo: context.ownerEmail ? { address: context.ownerEmail } : undefined,
    subject: headerText(subject),
    text: `${lines.join("\n")}\n`,
  };
}

export function quoteEmail(quote: QuoteDoc, context: BillingMailContext): EmailMessage {
  const total = formatMoney(money(quote.totals.totalMinor, quote.currency));
  const shares = scheduleAmounts(quote.totals, quote.taxes, quote.schedule);
  const payments =
    quote.schedule.length > 1
      ? quote.schedule.map(
          (step, index) =>
            `- ${step.label} (${formatPercent(step.basisPoints)}): ${formatMoney(money(shares[index] ?? 0, quote.currency))}`,
        )
      : [];
  return message(quote, context, `Quote ${quote.number}: ${quote.title}`, [
    `Here is my quote for ${quote.title}: ${total}.`,
    ...(payments.length ? ["", "Paid in parts:", ...payments] : []),
    "",
    `Read it, and accept it if it suits you, here (valid until ${longDate(quote.validUntil ?? "")}):`,
    `${context.siteUrl}/q/${quote.publicId}`,
    "",
    "Questions or changes? Just reply to this email.",
  ]);
}

export function invoiceEmail(invoice: InvoiceDoc, context: BillingMailContext, again = false): EmailMessage {
  const due = formatMoney(money(amountLeft(invoice), invoice.currency));
  const label = invoice.label ?? "Invoice";
  return message(invoice, context, `${label} ${invoice.number}: ${invoice.title}`, [
    again
      ? `A reminder of ${label.toLowerCase()} ${invoice.number} for ${invoice.title}.`
      : `Here is ${label.toLowerCase()} ${invoice.number} for ${invoice.title}.`,
    "",
    `Amount due: ${due}`,
    ...(invoice.dueDate ? [`Due by: ${longDate(invoice.dueDate)}`] : []),
    "",
    "How to pay, and a PDF copy:",
    `${context.siteUrl}/i/${invoice.publicId}`,
    "",
    "Already paid? Thank you, and please ignore this. Questions? Just reply.",
  ]);
}

// A reminder of an unpaid invoice past its due date: the first two friendly, the last one says it's the last.
export function reminderEmail(
  invoice: InvoiceDoc,
  context: BillingMailContext,
  count: number,
  today: string,
): EmailMessage {
  const due = formatMoney(money(amountLeft(invoice), invoice.currency));
  const label = invoice.label ?? "Invoice";
  const dueDate = invoice.dueDate ? longDate(invoice.dueDate) : longDate(today);
  const last = count >= 3;
  return message(invoice, context, `Reminder: ${label.toLowerCase()} ${invoice.number} is overdue`, [
    `A friendly reminder that ${label.toLowerCase()} ${invoice.number} for ${invoice.title} was due on ${dueDate} and is still open.`,
    "",
    `Amount due: ${due}`,
    "",
    "How to pay, and a PDF copy:",
    `${context.siteUrl}/i/${invoice.publicId}`,
    "",
    last
      ? "This is the last automatic reminder. If something is holding the payment up, just reply and we'll find a way."
      : "Already paid? Thank you, and please ignore this. If something is holding it up, just reply.",
  ]);
}

// --- The owner's alerts ----------------------------------------------------------------------------------------

export type QuoteAnswer = "accepted" | "declined";

export function quoteAnswerEmail(
  quote: QuoteDoc,
  answer: QuoteAnswer,
  { to: address, siteUrl }: { to: string; siteUrl: string },
): EmailMessage {
  const total = formatMoney(money(quote.totals.totalMinor, quote.currency));
  const lines =
    answer === "accepted"
      ? [
          `${quote.acceptedBy?.name ?? quote.recipient.name} accepted ${quote.number} (${quote.title}, ${total}).`,
          "",
          "The project is on your board and the first invoice was sent to them.",
        ]
      : [
          `${quote.recipient.name} declined ${quote.number} (${quote.title}, ${total}).`,
          ...(quote.declineReason ? ["", "Their reason:", quote.declineReason] : []),
        ];
  return {
    to: [{ address }],
    subject: headerText(`Quote ${answer}: ${quote.number}, ${quote.title}`),
    text: `${[...lines, "", `Open it: ${siteUrl}/admin/billing/quotes/${quote._id.toHexString()}`].join("\n")}\n`,
  };
}

export function quoteAnswerDiscord(quote: QuoteDoc, answer: QuoteAnswer, siteUrl: string): DiscordPayload {
  const url = `${siteUrl}/admin/billing/quotes/${quote._id.toHexString()}`;
  const fields = [
    { name: "Client", value: discordSafe(quote.recipient.name), inline: true },
    { name: "Total", value: formatMoney(money(quote.totals.totalMinor, quote.currency)), inline: true },
  ];
  if (answer === "declined" && quote.declineReason) {
    fields.push({ name: "Their reason", value: discordSafe(quote.declineReason), inline: false });
  }
  fields.push({ name: "Manage", value: `[Open the quote](${url})`, inline: false });
  return {
    embeds: [
      {
        title: `Quote ${answer}: ${quote.number}`,
        color: answer === "accepted" ? 0x34d399 : 0xf87171,
        description: discordSafe(quote.title, 300),
        fields,
        footer: { text: "leffloard.xyz billing" },
        timestamp: (quote.answeredAt ?? new Date()).toISOString(),
        url,
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

// --- Payments --------------------------------------------------------------------------------------------------

const METHOD_WORDS = { bank: "by bank transfer", crypto: "in cryptocurrency", card: "by card" } as const;

export function receiptEmail(
  invoice: InvoiceDoc,
  payment: PaymentDoc,
  context: BillingMailContext,
): EmailMessage {
  const amount = formatMoney(money(payment.amountMinor, payment.currency));
  const left = amountLeft(invoice);
  return message(invoice, context, `Payment received: ${invoice.number}`, [
    `Thank you: your payment of ${amount} ${METHOD_WORDS[payment.method]} for ${invoice.title} (${invoice.number}) has arrived.`,
    ...(left > 0
      ? [
          "",
          `${formatMoney(money(left, invoice.currency))} is still to pay${invoice.dueDate ? `, by ${longDate(invoice.dueDate)}` : ""}.`,
        ]
      : []),
    "",
    "The invoice, marked paid, and a PDF copy:",
    `${context.siteUrl}/i/${invoice.publicId}`,
  ]);
}

export type PaymentEvent = "received" | "review";

export function paymentAlertEmail(
  invoice: InvoiceDoc,
  payment: PaymentDoc,
  event: PaymentEvent,
  { to: address, siteUrl }: { to: string; siteUrl: string },
): EmailMessage {
  const amount = formatMoney(money(payment.amountMinor, payment.currency));
  const lines =
    event === "received"
      ? [
          `${amount} ${METHOD_WORDS[payment.method]} for ${invoice.number} (${invoice.title}, ${invoice.recipient.name}).`,
        ]
      : [
          `A payment for ${invoice.number} (${invoice.title}, ${invoice.recipient.name}) needs your review:`,
          payment.reviewReason ?? "",
        ];
  return {
    to: [{ address }],
    subject: headerText(
      event === "received"
        ? `Payment received: ${invoice.number}, ${amount}`
        : `Payment to review: ${invoice.number}`,
    ),
    text: `${[...lines, "", `Open it: ${siteUrl}/admin/billing/invoices/${invoice._id.toHexString()}`].join("\n")}\n`,
  };
}

export function paymentAlertDiscord(
  invoice: InvoiceDoc,
  payment: PaymentDoc,
  event: PaymentEvent,
  siteUrl: string,
): DiscordPayload {
  const url = `${siteUrl}/admin/billing/invoices/${invoice._id.toHexString()}`;
  const fields = [
    { name: "Client", value: discordSafe(invoice.recipient.name), inline: true },
    { name: "Amount", value: formatMoney(money(payment.amountMinor, payment.currency)), inline: true },
  ];
  if (event === "review" && payment.reviewReason) {
    fields.push({ name: "Why", value: discordSafe(payment.reviewReason), inline: false });
  }
  fields.push({ name: "Manage", value: `[Open the invoice](${url})`, inline: false });
  return {
    embeds: [
      {
        title:
          event === "received"
            ? `Payment received: ${invoice.number}`
            : `Payment to review: ${invoice.number}`,
        color: event === "received" ? 0x34d399 : 0xf59e0b,
        description: discordSafe(invoice.title, 300),
        fields,
        footer: { text: "leffloard.xyz billing" },
        timestamp: payment.updatedAt.toISOString(),
        url,
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

// --- Recurring invoices ----------------------------------------------------------------------------------------

export function recurringProblemEmail(
  plan: RecurringInvoiceDoc,
  problem: string,
  { to: address, siteUrl }: { to: string; siteUrl: string },
): EmailMessage {
  return {
    to: [{ address }],
    subject: headerText(`Recurring invoice not issued: ${plan.title}`),
    text: `${[
      `The recurring invoice "${plan.title}" for ${plan.recipient.name} was due on ${plan.nextOn ? longDate(plan.nextOn) : "its date"}, but couldn't be issued:`,
      problem,
      "",
      "Fix it and it goes out on the next run, or issue it by hand:",
      `${siteUrl}/admin/billing/recurring/${plan._id.toHexString()}`,
    ].join("\n")}\n`,
  };
}

export function recurringProblemDiscord(
  plan: RecurringInvoiceDoc,
  problem: string,
  siteUrl: string,
): DiscordPayload {
  const url = `${siteUrl}/admin/billing/recurring/${plan._id.toHexString()}`;
  return {
    embeds: [
      {
        title: "Recurring invoice not issued",
        color: 0xf59e0b,
        description: discordSafe(`${plan.title} (${plan.recipient.name}): ${problem}`, 600),
        fields: [{ name: "Manage", value: `[Open the plan](${url})`, inline: false }],
        footer: { text: "leffloard.xyz billing" },
        timestamp: plan.updatedAt.toISOString(),
        url,
      },
    ],
    allowed_mentions: { parse: [] },
  };
}
