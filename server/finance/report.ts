import "server-only";
import type { Db } from "mongodb";
import { PAYMENT_METHOD_LABELS } from "@/lib/billing/options";
import { toCsv, type CsvCell, type CsvFormat } from "@/lib/finance/csv";
import { bulletinFor, convertMinor, type Bulletin } from "@/lib/finance/fx";
import {
  AGING_BUCKETS,
  AGING_LABELS,
  agingBucket,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type AgingBucket,
  type ExpenseCategory,
} from "@/lib/finance/options";
import { SHORT_MONTHS } from "@/lib/format";
import { money, totalsByCurrency, type Currency, type Money } from "@/lib/money";
import { invoices, payments } from "@/server/billing/collections";
import { amountLeft } from "@/server/billing/payments";
import { expenses } from "@/server/finance/collections";
import { dayOf, daySpan, paymentDay } from "@/server/finance/days";
import { loadBulletins } from "@/server/finance/rates";
import { clients } from "@/server/work/collections";

// The money that came in and went out over a span of days, each amount also in the base currency at TCMB's
// rate for its day, and what clients still owe. An amount without a rate is left out of the base totals and
// listed, never guessed.

export type FinanceEntry = {
  kind: "payment" | "refund" | "expense";
  date: string;
  amountMinor: number; // positive; the kind says which way it went
  currency: Currency;
  document: string; // the invoice's number, or the expense's receipt
  party: string; // the client, or who was paid
  description: string;
  category: ExpenseCategory | null;
  method: string;
  reference: string;
  clientKey: string | null; // payments: the client (or the invoice's recipient) it came from
  // In the base currency: the amount, and the bulletin used. Null without a rate.
  baseMinor: number | null;
  bulletin: Bulletin | null;
};

const SIGN = { payment: 1, refund: -1, expense: -1 } as const;

export function signedMinor(entry: Pick<FinanceEntry, "kind" | "amountMinor">): number {
  return SIGN[entry.kind] * entry.amountMinor;
}

export async function financeEntries(
  db: Db,
  { from, to, base }: { from: string; to: string; base: Currency },
): Promise<FinanceEntry[]> {
  const { start, end } = daySpan(from, to);
  const [received, refunded, spent, bulletins] = await Promise.all([
    payments(db)
      .find({
        status: { $in: ["confirmed", "refunded"] },
        $or: [
          { receivedOn: { $gte: from, $lte: to } },
          { receivedOn: null, confirmedAt: { $gte: start, $lt: end } },
        ],
      })
      .toArray(),
    payments(db)
      .find({ status: "refunded", refundedAt: { $gte: start, $lt: end } })
      .toArray(),
    expenses(db)
      .find({ date: { $gte: from, $lte: to } })
      .toArray(),
    loadBulletins(db, from, to),
  ]);

  const invoiceDocs = await invoices(db)
    .find(
      { _id: { $in: [...received, ...refunded].map((payment) => payment.invoiceId) } },
      { projection: { number: 1, title: 1, recipient: 1, clientId: 1 } },
    )
    .toArray();
  const invoiceById = new Map(invoiceDocs.map((invoice) => [invoice._id.toHexString(), invoice]));
  const clientIds = invoiceDocs.flatMap((invoice) => (invoice.clientId ? [invoice.clientId] : []));
  const clientDocs = clientIds.length
    ? await clients(db)
        .find({ _id: { $in: clientIds } }, { projection: { name: 1, company: 1 } })
        .toArray()
    : [];
  const clientName = new Map(
    clientDocs.map((client) => [client._id.toHexString(), client.company ?? client.name]),
  );

  const convert = (date: string, amountMinor: number, currency: Currency) => {
    if (currency === base) return { baseMinor: amountMinor, bulletin: null };
    const bulletin = bulletinFor(bulletins, date);
    return {
      baseMinor: bulletin ? convertMinor(amountMinor, currency, base, bulletin.rates) : null,
      bulletin,
    };
  };

  const fromPayment = (kind: "payment" | "refund", date: string) => (payment: (typeof received)[number]) => {
    const invoice = invoiceById.get(payment.invoiceId.toHexString());
    const party = invoice
      ? invoice.clientId
        ? (clientName.get(invoice.clientId.toHexString()) ?? invoice.recipient.name)
        : (invoice.recipient.company ?? invoice.recipient.name)
      : "";
    return {
      kind,
      date,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      document: invoice?.number ?? "",
      party,
      description: invoice?.title ?? "",
      category: null,
      method: `${PAYMENT_METHOD_LABELS[payment.method]}${payment.provider ? " (NOWPayments)" : ""}`,
      reference: [
        payment.reference,
        payment.provider?.paymentId ? `payment ${payment.provider.paymentId}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      clientKey: invoice ? (invoice.clientId?.toHexString() ?? `recipient:${party}`) : null,
      ...convert(date, payment.amountMinor, payment.currency),
    } satisfies FinanceEntry;
  };

  const entries: FinanceEntry[] = [
    ...received.map((payment) => fromPayment("payment", paymentDay(payment))(payment)),
    ...refunded.map((payment) => fromPayment("refund", dayOf(payment.refundedAt!))(payment)),
    ...spent.map((expense): FinanceEntry => ({
      kind: "expense",
      date: expense.date,
      amountMinor: expense.amountMinor,
      currency: expense.currency,
      document: expense.reference,
      party: expense.vendor,
      description: expense.description,
      category: expense.category,
      method: "",
      reference: "",
      clientKey: null,
      ...convert(expense.date, expense.amountMinor, expense.currency),
    })),
  ].filter((entry) => entry.date >= from && entry.date <= to);
  return entries.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

export type MonthRow = {
  key: string; // "2026-09"
  label: string; // "Sep 2026"
  incomeMinor: number;
  expenseMinor: number;
  profitMinor: number;
};

export type AgingRow = {
  bucket: AgingBucket;
  label: string;
  count: number;
  byCurrency: Money[];
  baseMinor: number | null; // null when a currency had no rate
};

export type FinanceReport = {
  base: Currency;
  from: string;
  to: string;
  months: MonthRow[];
  incomeMinor: number;
  incomeByCurrency: Money[];
  expenseMinor: number;
  expenseByCurrency: Money[];
  expenseByCategory: { category: ExpenseCategory; label: string; baseMinor: number }[];
  profitMinor: number;
  byClient: { key: string; name: string; baseMinor: number }[];
  aging: AgingRow[];
  owedMinor: number | null;
  missing: { date: string; currency: Currency }[]; // left out of the base totals for want of a rate
};

// The months from one day's month to another's, in order.
export function monthKeys(from: string, to: string): string[] {
  const keys: string[] = [];
  let [year, month] = from.split("-").map(Number) as [number, number];
  const last = to.slice(0, 7);
  for (;;) {
    const key = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
    if (key > last) break;
    keys.push(key);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return keys;
}

export function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number) as [number, number];
  return `${SHORT_MONTHS[month - 1]} ${year}`;
}

// Money in minus refunds, in the base currency.
function netIncome(entries: FinanceEntry[]): number {
  return entries.reduce((total, entry) => total + SIGN[entry.kind] * (entry.baseMinor ?? 0), 0);
}

// Money out, in the base currency.
function spending(entries: FinanceEntry[]): number {
  return entries.reduce((total, entry) => total + (entry.baseMinor ?? 0), 0);
}

export async function financeReport(
  db: Db,
  { from, to, today, base }: { from: string; to: string; today: string; base: Currency },
): Promise<FinanceReport> {
  const [entries, open, current] = await Promise.all([
    financeEntries(db, { from, to, base }),
    invoices(db)
      .find(
        { status: "issued", kind: "invoice" },
        { projection: { totals: 1, paidMinor: 1, currency: 1, dueDate: 1 } },
      )
      .toArray(),
    loadBulletins(db, today, today),
  ]);
  const income = entries.filter((entry) => entry.kind !== "expense");
  const spent = entries.filter((entry) => entry.kind === "expense");
  const incomeMinor = netIncome(income);
  const expenseMinor = spending(spent);

  const months = monthKeys(from, to).map((key): MonthRow => {
    const inMonth = entries.filter((entry) => entry.date.startsWith(key));
    const monthIncome = netIncome(inMonth.filter((entry) => entry.kind !== "expense"));
    const monthExpense = spending(inMonth.filter((entry) => entry.kind === "expense"));
    return {
      key,
      label: monthLabel(key),
      incomeMinor: monthIncome,
      expenseMinor: monthExpense,
      profitMinor: monthIncome - monthExpense,
    };
  });

  const byCategory = EXPENSE_CATEGORIES.map((category) => ({
    category,
    label: EXPENSE_CATEGORY_LABELS[category],
    baseMinor: spending(spent.filter((entry) => entry.category === category)),
  }))
    .filter((row) => row.baseMinor !== 0)
    .sort((a, b) => b.baseMinor - a.baseMinor);

  const clientTotals = new Map<string, { name: string; baseMinor: number }>();
  for (const entry of income) {
    if (!entry.clientKey) continue;
    const row = clientTotals.get(entry.clientKey) ?? { name: entry.party || "Unknown", baseMinor: 0 };
    row.baseMinor += SIGN[entry.kind] * (entry.baseMinor ?? 0);
    clientTotals.set(entry.clientKey, row);
  }
  const byClient = [...clientTotals]
    .map(([key, row]) => ({ key, ...row }))
    .filter((row) => row.baseMinor !== 0)
    .sort((a, b) => b.baseMinor - a.baseMinor)
    .slice(0, 8);

  // What clients owe today, valued at today's rate.
  const todayBulletin = bulletinFor(current, today);
  const aging = AGING_BUCKETS.map((bucket): AgingRow => {
    const owed = open
      .filter((invoice) => agingBucket(invoice.dueDate, today) === bucket)
      .map((invoice) => money(amountLeft(invoice), invoice.currency))
      .filter((value) => value.amountMinor > 0);
    let baseMinor: number | null = 0;
    for (const value of owed) {
      const converted =
        value.currency === base
          ? value.amountMinor
          : todayBulletin
            ? convertMinor(value.amountMinor, value.currency, base, todayBulletin.rates)
            : null;
      baseMinor = converted === null || baseMinor === null ? null : baseMinor + converted;
    }
    return {
      bucket,
      label: AGING_LABELS[bucket],
      count: owed.length,
      byCurrency: totalsByCurrency(owed),
      baseMinor,
    };
  });
  const owedMinor = aging.some((row) => row.baseMinor === null)
    ? null
    : aging.reduce((total, row) => total + (row.baseMinor ?? 0), 0);

  const missing = new Map<string, { date: string; currency: Currency }>();
  for (const entry of entries) {
    if (entry.baseMinor === null)
      missing.set(`${entry.date}:${entry.currency}`, { date: entry.date, currency: entry.currency });
  }

  return {
    base,
    from,
    to,
    months,
    incomeMinor,
    incomeByCurrency: totalsByCurrency(income.map((entry) => money(signedMinor(entry), entry.currency))),
    expenseMinor,
    expenseByCurrency: totalsByCurrency(spent.map((entry) => money(entry.amountMinor, entry.currency))),
    expenseByCategory: byCategory,
    profitMinor: incomeMinor - expenseMinor,
    byClient,
    aging,
    owedMinor,
    missing: [...missing.values()],
  };
}

const KIND_LABELS = { payment: "Payment received", refund: "Refund", expense: "Expense" } as const;

// Every movement of money between two days, for the accountant: signed amounts (money in is positive),
// TCMB's rate and bulletin date, and the amount in the base currency.
export async function financeCsv(
  db: Db,
  { from, to, base, format }: { from: string; to: string; base: Currency; format: CsvFormat },
): Promise<{ csv: string; rows: number; missing: number }> {
  const entries = await financeEntries(db, { from, to, base });
  const header = [
    "Date",
    "Type",
    "Document",
    "Party",
    "Description",
    "Category",
    "Method",
    "Reference",
    "Currency",
    "Amount",
    "TCMB bulletin",
    "TCMB rate (TRY)",
    `Amount (${base})`,
  ];
  const rows = entries.map((entry): CsvCell[] => {
    const rate = entry.currency === "TRY" ? null : (entry.bulletin?.rates[entry.currency] ?? null);
    return [
      entry.date,
      KIND_LABELS[entry.kind],
      entry.document,
      entry.party,
      entry.description,
      entry.category ? EXPENSE_CATEGORY_LABELS[entry.category] : "",
      entry.method,
      entry.reference,
      entry.currency,
      { minor: signedMinor(entry) },
      entry.bulletin?.date ?? null,
      rate === null ? null : { rate },
      entry.baseMinor === null ? null : { minor: SIGN[entry.kind] * entry.baseMinor },
    ];
  });
  return {
    csv: toCsv(header, rows, format),
    rows: rows.length,
    missing: entries.filter((entry) => entry.baseMinor === null).length,
  };
}
