import "server-only";
import {
  amountLeft,
  formatPercent,
  formatQuantity,
  lineAmount,
  scheduleAmounts,
} from "@/lib/billing/document";
import { formatIban } from "@/lib/billing/iban";
import { PAYMENT_METHOD_LABELS } from "@/lib/billing/options";
import { formatMoneyCode, money, type Currency } from "@/lib/money";
import { bankAccountFor } from "@/server/billing/invoices";
import type { BillingSettings } from "@/server/billing/settings";
import type { BankAccount, BusinessProfile, InvoiceDoc, QuoteDoc, Recipient } from "@/server/billing/types";

// A quote or an invoice as the client reads it, for the HTML page and the PDF alike: every amount and date
// already written out, so both show exactly the same thing.

export type DocumentView = {
  heading: string; // "Quote", "Payment request", "Invoice", "Credit note"
  number: string; // "Draft" until numbered
  title: string;
  seller: BusinessProfile;
  recipient: Recipient;
  dates: { label: string; value: string }[];
  lines: { description: string; quantity: string; unit: string; amount: string }[];
  totals: { label: string; value: string; strong?: boolean }[];
  schedule: { label: string; amount: string }[];
  facts: { label: string; value: string }[];
  payment: {
    bank: (Omit<BankAccount, "iban"> & { iban: string }) | null;
    reference: string;
    onlineUrl: string | null;
    methods: string[];
  } | null;
  notes: string;
  stamp: string | null; // "Paid", "Void", "Accepted"
};

// "28 September 2026".
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function longDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

function amounts(doc: QuoteDoc | InvoiceDoc) {
  const format = (minor: number, currency: Currency = doc.currency) =>
    formatMoneyCode(money(minor, currency));
  const lines = doc.lines.map((line) => ({
    description: line.description,
    quantity: formatQuantity(line.quantityMilli),
    unit: format(line.unitMinor),
    amount: format(lineAmount(line)),
  }));
  const totals: DocumentView["totals"] = [];
  const { subtotalMinor, discountMinor, taxes, totalMinor } = doc.totals;
  if (discountMinor || taxes.length) totals.push({ label: "Subtotal", value: format(subtotalMinor) });
  if (discountMinor) {
    const label =
      doc.discount?.kind === "percent" ? `Discount (${formatPercent(doc.discount.basisPoints)})` : "Discount";
    totals.push({ label, value: `-${format(discountMinor)}` });
  }
  for (const tax of taxes)
    totals.push({
      label: `${tax.label} (${formatPercent(tax.basisPoints)})`,
      value: format(tax.amountMinor),
    });
  totals.push({ label: "Total", value: format(totalMinor), strong: true });
  return { format, lines, totals };
}

export function quoteView(quote: QuoteDoc, settings: BillingSettings): DocumentView {
  const { format, lines, totals } = amounts(quote);
  const shares = scheduleAmounts(quote.totals, quote.taxes, quote.schedule);
  const facts: DocumentView["facts"] = [];
  if (quote.timeline) facts.push({ label: "Timeline", value: quote.timeline });
  facts.push({
    label: "Revision rounds included",
    value: quote.revisionsIncluded ? String(quote.revisionsIncluded) : "None",
  });
  if (quote.extraRevisionMinor !== null) {
    facts.push({ label: "Each further round", value: format(quote.extraRevisionMinor) });
  }
  const dates: DocumentView["dates"] = [];
  if (quote.sentAt && quote.validUntil)
    dates.push({ label: "Valid until", value: longDate(quote.validUntil) });
  return {
    heading: "Quote",
    number: quote.number ?? "Draft",
    title: quote.title,
    seller: quote.seller ?? settings.business,
    recipient: quote.recipient,
    dates,
    lines,
    totals,
    schedule: quote.schedule.map((step, index) => ({
      label: `${step.label} (${formatPercent(step.basisPoints)})`,
      amount: format(shares[index] ?? 0),
    })),
    facts,
    payment: null,
    notes: quote.notes,
    stamp: quote.status === "accepted" ? "Accepted" : quote.status === "declined" ? "Declined" : null,
  };
}

export function invoiceView(invoice: InvoiceDoc, settings: BillingSettings, siteUrl: string): DocumentView {
  const { format, lines, totals } = amounts(invoice);
  const credit = invoice.kind === "credit";
  const creditedMinor = invoice.creditedMinor ?? 0;
  if (!credit && (invoice.paidMinor > 0 || creditedMinor > 0) && invoice.status !== "void") {
    if (invoice.paidMinor > 0) totals.push({ label: "Paid", value: `-${format(invoice.paidMinor)}` });
    if (creditedMinor > 0) totals.push({ label: "Credit notes", value: `-${format(creditedMinor)}` });
    totals.push({ label: "Left to pay", value: format(amountLeft(invoice)), strong: true });
  }
  const dates: DocumentView["dates"] = [];
  if (invoice.issueDate) dates.push({ label: "Issued", value: longDate(invoice.issueDate) });
  if (invoice.dueDate) dates.push({ label: "Due", value: longDate(invoice.dueDate) });
  // A draft previews the account it would be issued with.
  const bank =
    invoice.status === "draft"
      ? bankAccountFor(settings.bankAccounts, invoice.currency)
      : invoice.bankAccount;
  const payable = !credit && invoice.status === "issued";
  return {
    heading: credit ? "Credit note" : (invoice.label ?? settings.documentLabel),
    number: invoice.number ?? "Draft",
    title: invoice.title,
    seller: invoice.seller ?? settings.business,
    recipient: invoice.recipient,
    dates,
    lines,
    totals,
    schedule: [],
    facts: [],
    payment:
      credit || invoice.status === "void"
        ? null
        : {
            bank: bank && invoice.methods.includes("bank") ? { ...bank, iban: formatIban(bank.iban) } : null,
            reference: invoice.number ?? "",
            onlineUrl:
              payable && invoice.methods.includes("crypto") ? `${siteUrl}/i/${invoice.publicId}` : null,
            methods: invoice.methods.map((method) => PAYMENT_METHOD_LABELS[method]),
          },
    notes: invoice.notes,
    stamp:
      invoice.status === "paid"
        ? invoice.paidMinor > 0
          ? "Paid"
          : "Settled"
        : invoice.status === "void"
          ? "Void"
          : null,
  };
}
