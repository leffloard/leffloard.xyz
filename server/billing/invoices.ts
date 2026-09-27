import "server-only";
import { ObjectId, type ClientSession, type Db, type Filter } from "mongodb";
import { computeTotals, type Discount, type LineItem, type TaxLine } from "@/lib/billing/document";
import type { PaymentMethod } from "@/lib/billing/options";
import { addDays } from "@/lib/intake/time";
import { formatMoney, money, type Currency } from "@/lib/money";
import { invoices } from "@/server/billing/collections";
import { nextDocumentNumber } from "@/server/billing/numbering";
import { newPublicId } from "@/server/billing/public-id";
import type { BillingSettings } from "@/server/billing/settings";
import type { BankAccount, InvoiceDoc, InvoiceKind, Recipient } from "@/server/billing/types";
import { now } from "@/server/clock";
import { inTransaction } from "@/server/db/transaction";

// Invoices and credit notes. A draft is edited freely; issuing numbers it and freezes it, with the seller's
// details, the document's label and the bank account as they are that day. After that only its payments and
// status change: a mistake is corrected by voiding it (before any payment) or by a credit note.

export type InvoiceInput = {
  title: string;
  clientId: ObjectId | null;
  projectId: ObjectId | null;
  recipient: Recipient;
  currency: Currency;
  lines: LineItem[];
  discount: Discount | null;
  taxes: TaxLine[];
  notes: string;
  methods: PaymentMethod[];
};

export type InvoiceChange =
  | { ok: true; invoice: InvoiceDoc }
  | { ok: false; reason: "missing" | "conflict" | "locked" | "invalid"; message?: string };

function draftFields(input: InvoiceInput) {
  return { ...input, totals: computeTotals(input.lines, input.discount, input.taxes) };
}

export async function createInvoice(
  db: Db,
  input: InvoiceInput,
  options: { kind?: InvoiceKind; quoteId?: ObjectId | null; creditFor?: ObjectId | null } = {},
  at: Date = now(),
): Promise<InvoiceDoc> {
  const doc: InvoiceDoc = {
    _id: new ObjectId(),
    publicId: newPublicId(),
    kind: options.kind ?? "invoice",
    number: null,
    status: "draft",
    ...draftFields(input),
    quoteId: options.quoteId ?? null,
    creditFor: options.creditFor ?? null,
    seller: null,
    label: null,
    bankAccount: null,
    paidMinor: 0,
    creditedMinor: 0,
    issueDate: null,
    dueDate: null,
    viewedAt: null,
    remindersSent: 0,
    lastReminderAt: null,
    paidAt: null,
    voidedAt: null,
    voidReason: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
  await invoices(db).insertOne(doc);
  return doc;
}

async function explain(db: Db, id: ObjectId): Promise<InvoiceChange> {
  const current = await invoices(db).findOne({ _id: id }, { projection: { status: 1 } });
  if (!current) return { ok: false, reason: "missing" };
  return { ok: false, reason: current.status === "draft" ? "conflict" : "locked" };
}

export async function updateInvoice(
  db: Db,
  id: ObjectId,
  version: number,
  input: InvoiceInput,
  at: Date = now(),
): Promise<InvoiceChange> {
  const updated = await invoices(db).findOneAndUpdate(
    { _id: id, version, status: "draft" },
    { $set: { ...draftFields(input), updatedAt: at }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
  return updated ? { ok: true, invoice: updated } : explain(db, id);
}

export async function deleteDraftInvoice(db: Db, id: ObjectId): Promise<boolean> {
  return (await invoices(db).deleteOne({ _id: id, status: "draft" })).deletedCount === 1;
}

// The account a client pays by transfer: one in the invoice's currency, or one that takes any currency.
export function bankAccountFor(accounts: BankAccount[], currency: Currency): BankAccount | null {
  return (
    accounts.find((account) => account.currency === currency) ??
    accounts.find((account) => account.currency === null) ??
    null
  );
}

type IssueCheck = { ok: true; bankAccount: BankAccount | null } | { ok: false; message: string };

export function checkIssue(
  invoice: Pick<InvoiceDoc, "kind" | "totals" | "methods" | "currency">,
  settings: BillingSettings,
): IssueCheck {
  if (invoice.totals.totalMinor <= 0) return { ok: false, message: "Add at least one line with an amount." };
  // A credit note is not paid, so it offers no way to pay.
  if (invoice.kind === "credit") return { ok: true, bankAccount: null };
  if (invoice.methods.length === 0) return { ok: false, message: "Choose at least one way to pay." };
  if (!invoice.methods.includes("bank")) return { ok: true, bankAccount: null };
  const bankAccount = bankAccountFor(settings.bankAccounts, invoice.currency);
  if (!bankAccount) {
    return {
      ok: false,
      message: `Add a bank account for ${invoice.currency} in the billing settings, or untick bank transfer.`,
    };
  }
  return { ok: true, bankAccount };
}

// What issuing sets on a draft: its number, dates and the frozen details.
async function issueFields(
  db: Db,
  invoice: Pick<InvoiceDoc, "kind">,
  settings: BillingSettings,
  bankAccount: BankAccount | null,
  today: string,
  session: ClientSession,
) {
  return {
    status: "issued" as const,
    number: await nextDocumentNumber(
      db,
      invoice.kind === "credit" ? "credit" : "invoice",
      Number(today.slice(0, 4)),
      session,
    ),
    seller: settings.business,
    label: settings.documentLabel,
    bankAccount,
    issueDate: today,
    dueDate: invoice.kind === "credit" ? null : addDays(today, settings.paymentTermsDays),
  };
}

// A credit note takes its total off the invoice it corrects, in the transaction that issues it: never more
// than the invoice's total in all, and never in another currency. An invoice that payments and credit notes
// then cover is settled (paid). Runs before anything else is written, so a refusal leaves nothing behind.
async function applyCredit(
  db: Db,
  note: InvoiceDoc,
  at: Date,
  session: ClientSession,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const original = note.creditFor ? await invoices(db).findOne({ _id: note.creditFor }, { session }) : null;
  if (!original || original.kind !== "invoice" || !["issued", "paid"].includes(original.status)) {
    return { ok: false, message: "The invoice this corrects can no longer be credited." };
  }
  if (original.currency !== note.currency) {
    return { ok: false, message: `A credit note is in its invoice's currency (${original.currency}).` };
  }
  const room = original.totals.totalMinor - (original.creditedMinor ?? 0);
  if (note.totals.totalMinor > room) {
    return {
      ok: false,
      message: `At most ${formatMoney(money(room, original.currency))} is left to credit on ${original.number}.`,
    };
  }
  const settled = { $add: ["$paidMinor", "$creditedMinor"] };
  const settles = { $and: [{ $eq: ["$status", "issued"] }, { $gte: [settled, "$totals.totalMinor"] }] };
  const updated = await invoices(db).updateOne(
    {
      _id: original._id,
      status: { $in: ["issued", "paid"] },
      $expr: {
        $lte: [{ $add: [{ $ifNull: ["$creditedMinor", 0] }, note.totals.totalMinor] }, "$totals.totalMinor"],
      },
    },
    [
      {
        $set: {
          creditedMinor: { $add: [{ $ifNull: ["$creditedMinor", 0] }, note.totals.totalMinor] },
          updatedAt: at,
          version: { $add: ["$version", 1] },
        },
      },
      {
        $set: {
          status: { $cond: [settles, "paid", "$status"] },
          paidAt: { $cond: [settles, at, "$paidAt"] },
        },
      },
    ],
    { session },
  );
  if (updated.matchedCount !== 1) {
    return { ok: false, message: "The invoice this corrects changed meanwhile. Reload and try again." };
  }
  return { ok: true };
}

// Issues a draft: numbered in the same transaction, so two issues at once never share a number.
export async function issueInvoice(
  db: Db,
  id: ObjectId,
  version: number,
  settings: BillingSettings,
  today: string,
  at: Date = now(),
): Promise<InvoiceChange> {
  return inTransaction(db, async (session) => {
    const draft = await invoices(db).findOne({ _id: id, version, status: "draft" }, { session });
    if (!draft) return explain(db, id);
    const check = checkIssue(draft, settings);
    if (!check.ok) return { ok: false, reason: "invalid", message: check.message };
    if (draft.kind === "credit") {
      const credited = await applyCredit(db, draft, at, session);
      if (!credited.ok) return { ok: false, reason: "invalid", message: credited.message };
    }
    const fields = await issueFields(db, draft, settings, check.bankAccount, today, session);
    const issued = await invoices(db).findOneAndUpdate(
      { _id: id, version, status: "draft" },
      { $set: { ...fields, updatedAt: at }, $inc: { version: 1 } },
      { session, returnDocument: "after" },
    );
    return issued ? { ok: true, invoice: issued } : { ok: false, reason: "conflict" };
  });
}

// A new invoice issued at once, inside a caller's transaction (the deposit of an accepted quote).
export async function createIssuedInvoice(
  db: Db,
  input: InvoiceInput,
  options: { quoteId: ObjectId | null; recurringId?: ObjectId; period?: string },
  settings: BillingSettings,
  today: string,
  session: ClientSession,
  at: Date = now(),
): Promise<InvoiceDoc> {
  const draft = { kind: "invoice" as const, ...draftFields(input) };
  const check = checkIssue(draft, settings);
  // Bank transfer without an account on file is left out rather than failing the client's acceptance.
  const methods = check.ok ? input.methods : input.methods.filter((method) => method !== "bank");
  const bankAccount = check.ok ? check.bankAccount : null;
  const doc: InvoiceDoc = {
    _id: new ObjectId(),
    publicId: newPublicId(),
    ...draft,
    methods,
    ...(await issueFields(db, draft, settings, bankAccount, today, session)),
    clientId: input.clientId,
    projectId: input.projectId,
    quoteId: options.quoteId,
    ...(options.recurringId ? { recurringId: options.recurringId, period: options.period ?? null } : {}),
    creditFor: null,
    paidMinor: 0,
    creditedMinor: 0,
    viewedAt: null,
    remindersSent: 0,
    lastReminderAt: null,
    paidAt: null,
    voidedAt: null,
    voidReason: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
  await invoices(db).insertOne(doc, { session });
  return doc;
}

// Voids an issued invoice nothing has been paid or credited on. Its number stays used, and it stays on record.
// A credit note is never voided: it has already changed what its invoice owes.
export async function voidInvoice(
  db: Db,
  id: ObjectId,
  version: number,
  reason: string,
  at: Date = now(),
): Promise<InvoiceChange> {
  const voided = await invoices(db).findOneAndUpdate(
    {
      _id: id,
      version,
      kind: "invoice",
      status: "issued",
      paidMinor: 0,
      creditedMinor: { $not: { $gt: 0 } },
    },
    { $set: { status: "void", voidedAt: at, voidReason: reason, updatedAt: at }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
  if (voided) return { ok: true, invoice: voided };
  const current = await invoices(db).findOne(
    { _id: id },
    { projection: { status: 1, kind: 1, paidMinor: 1, creditedMinor: 1, version: 1 } },
  );
  if (!current) return { ok: false, reason: "missing" };
  if (current.version !== version) return { ok: false, reason: "conflict" };
  return {
    ok: false,
    reason: "locked",
    message:
      current.kind === "credit"
        ? "A credit note can't be voided: issue a new invoice to take it back."
        : current.status !== "issued"
          ? "Only an issued invoice can be voided."
          : current.paidMinor > 0
            ? "Payments were made on it: record a refund or issue a credit note instead."
            : "A credit note was issued against it: it stays as it is.",
  };
}

// A draft credit note for an issued or paid invoice, with its lines to adjust.
export async function draftCreditNote(
  db: Db,
  invoiceId: ObjectId,
  at: Date = now(),
): Promise<InvoiceDoc | null> {
  const invoice = await invoices(db).findOne({
    _id: invoiceId,
    kind: "invoice",
    status: { $in: ["issued", "paid"] },
  });
  if (!invoice) return null;
  return createInvoice(
    db,
    {
      title: `Credit for ${invoice.number}`,
      clientId: invoice.clientId,
      projectId: invoice.projectId,
      recipient: invoice.recipient,
      currency: invoice.currency,
      lines: invoice.lines,
      discount: invoice.discount,
      taxes: invoice.taxes,
      notes: "",
      methods: [],
    },
    { kind: "credit", creditFor: invoice._id },
    at,
  );
}

export async function getInvoice(db: Db, id: ObjectId): Promise<InvoiceDoc | null> {
  return invoices(db).findOne({ _id: id });
}

export async function invoiceByPublicId(db: Db, publicId: string): Promise<InvoiceDoc | null> {
  return invoices(db).findOne({ publicId, status: { $ne: "draft" } });
}

// The client opened it (not the owner previewing it).
export async function markInvoiceViewed(db: Db, id: ObjectId, at: Date = now()): Promise<void> {
  await invoices(db).updateOne(
    { _id: id, viewedAt: null, status: { $ne: "draft" } },
    { $set: { viewedAt: at } },
  );
}

export const INVOICE_VIEWS = ["open", "drafts", "paid", "all"] as const;
export type InvoiceView = (typeof INVOICE_VIEWS)[number];

const VIEW_FILTERS: Record<InvoiceView, Filter<InvoiceDoc>> = {
  open: { status: "issued", kind: "invoice" },
  drafts: { status: "draft" },
  paid: { status: "paid" },
  all: {},
};

export async function listInvoices(
  db: Db,
  {
    view = "open",
    clientId,
    projectId,
  }: { view?: InvoiceView; clientId?: ObjectId; projectId?: ObjectId } = {},
): Promise<InvoiceDoc[]> {
  const filter: Filter<InvoiceDoc> = { ...VIEW_FILTERS[view] };
  if (clientId) filter.clientId = clientId;
  if (projectId) filter.projectId = projectId;
  // Open invoices by due date, the oldest debt first; the rest newest first.
  return invoices(db)
    .find(filter)
    .sort(view === "open" ? { dueDate: 1, _id: 1 } : { createdAt: -1 })
    .limit(500)
    .toArray();
}

// How many invoices each list holds.
export async function invoiceCounts(db: Db): Promise<Record<InvoiceView, number>> {
  const rows = await invoices(db)
    .aggregate<{ _id: { status: string; kind: string }; count: number }>([
      { $group: { _id: { status: "$status", kind: "$kind" }, count: { $sum: 1 } } },
    ])
    .toArray();
  const by = (status: string, kind?: string) =>
    rows
      .filter((row) => row._id.status === status && (!kind || row._id.kind === kind))
      .reduce((sum, row) => sum + row.count, 0);
  return {
    open: by("issued", "invoice"),
    drafts: by("draft"),
    paid: by("paid"),
    all: rows.reduce((sum, row) => sum + row.count, 0),
  };
}

// Issued invoices past their due date, for the sidebar.
export async function countOverdue(db: Db, today: string): Promise<number> {
  return invoices(db).countDocuments({ status: "issued", kind: "invoice", dueDate: { $lt: today } });
}
