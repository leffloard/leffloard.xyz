import "server-only";
import { randomUUID } from "node:crypto";
import { ObjectId, type Db, type Filter } from "mongodb";
import {
  computeTotals,
  formatPercent,
  splitSchedule,
  type Discount,
  type LineItem,
  type ScheduleStep,
  type TaxLine,
} from "@/lib/billing/document";
import type { QuoteStatus } from "@/lib/billing/options";
import { addDays } from "@/lib/intake/time";
import { money, type Currency } from "@/lib/money";
import { quotes } from "@/server/billing/collections";
import { createIssuedInvoice } from "@/server/billing/invoices";
import { nextDocumentNumber } from "@/server/billing/numbering";
import { newPublicId } from "@/server/billing/public-id";
import type { BillingSettings } from "@/server/billing/settings";
import type { InvoiceDoc, QuoteDoc, Recipient } from "@/server/billing/types";
import { now } from "@/server/clock";
import { inTransaction } from "@/server/db/transaction";
import { createProject } from "@/server/projects/store";
import type { ProjectDoc } from "@/server/projects/types";

// Quotes: drafted in the admin, sent as a link, accepted by the client. Acceptance is one transaction: the
// quote, a project with the quote's price and revision rounds, and the first payment's invoice, issued.

export type QuoteInput = {
  title: string;
  clientId: ObjectId;
  inquiryId: ObjectId | null;
  recipient: Recipient;
  currency: Currency;
  lines: LineItem[];
  discount: Discount | null;
  taxes: TaxLine[];
  notes: string;
  schedule: ScheduleStep[];
  timeline: string;
  revisionsIncluded: number;
  extraRevisionMinor: number | null;
};

export type QuoteChange =
  | { ok: true; quote: QuoteDoc }
  | { ok: false; reason: "missing" | "conflict" | "locked" | "invalid"; message?: string };

function draftFields(input: QuoteInput) {
  return { ...input, totals: computeTotals(input.lines, input.discount, input.taxes) };
}

export async function createQuote(db: Db, input: QuoteInput, at: Date = now()): Promise<QuoteDoc> {
  const doc: QuoteDoc = {
    _id: new ObjectId(),
    publicId: newPublicId(),
    number: null,
    status: "draft",
    ...draftFields(input),
    validUntil: null,
    sentAt: null,
    viewedAt: null,
    answeredAt: null,
    acceptedBy: null,
    declineReason: null,
    projectId: null,
    depositInvoiceId: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
  await quotes(db).insertOne(doc);
  return doc;
}

async function explain(db: Db, id: ObjectId, editable: QuoteStatus[]): Promise<QuoteChange> {
  const current = await quotes(db).findOne({ _id: id }, { projection: { status: 1 } });
  if (!current) return { ok: false, reason: "missing" };
  return { ok: false, reason: editable.includes(current.status) ? "conflict" : "locked" };
}

export async function updateQuote(
  db: Db,
  id: ObjectId,
  version: number,
  input: QuoteInput,
  at: Date = now(),
): Promise<QuoteChange> {
  const updated = await quotes(db).findOneAndUpdate(
    { _id: id, version, status: "draft" },
    { $set: { ...draftFields(input), updatedAt: at }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
  return updated ? { ok: true, quote: updated } : explain(db, id, ["draft"]);
}

// Only a quote that was never sent: one the client has seen keeps its record and number, and is withdrawn.
export async function deleteDraftQuote(db: Db, id: ObjectId): Promise<boolean> {
  return (await quotes(db).deleteOne({ _id: id, status: "draft", number: null })).deletedCount === 1;
}

// Sends a draft: it gets its number (once) and a date it is valid until, and the client's link starts to work.
export async function sendQuote(
  db: Db,
  id: ObjectId,
  version: number,
  settings: Pick<BillingSettings, "quoteValidityDays" | "business">,
  today: string,
  at: Date = now(),
): Promise<QuoteChange> {
  return inTransaction(db, async (session) => {
    const draft = await quotes(db).findOne({ _id: id, version, status: "draft" }, { session });
    if (!draft) return explain(db, id, ["draft"]);
    if (draft.totals.totalMinor <= 0)
      return { ok: false, reason: "invalid", message: "Add at least one line with an amount." };
    if (!draft.recipient.email) {
      return { ok: false, reason: "invalid", message: "Add the client's email address first." };
    }
    const number =
      draft.number ?? (await nextDocumentNumber(db, "quote", Number(today.slice(0, 4)), session));
    const sent = await quotes(db).findOneAndUpdate(
      { _id: id, version, status: "draft" },
      {
        $set: {
          status: "sent",
          number,
          seller: settings.business,
          sentAt: at,
          validUntil: addDays(today, settings.quoteValidityDays),
          updatedAt: at,
        },
        $inc: { version: 1 },
      },
      { session, returnDocument: "after" },
    );
    return sent ? { ok: true, quote: sent } : { ok: false, reason: "conflict" };
  });
}

// A sent quote back to a draft, to change it; its link says it is being updated until it is sent again.
export async function reopenQuote(
  db: Db,
  id: ObjectId,
  version: number,
  at: Date = now(),
): Promise<QuoteChange> {
  const reopened = await quotes(db).findOneAndUpdate(
    { _id: id, version, status: "sent" },
    { $set: { status: "draft", updatedAt: at }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
  return reopened ? { ok: true, quote: reopened } : explain(db, id, ["sent"]);
}

export async function withdrawQuote(
  db: Db,
  id: ObjectId,
  version: number,
  at: Date = now(),
): Promise<QuoteChange> {
  const withdrawn = await quotes(db).findOneAndUpdate(
    { _id: id, version, status: { $in: ["draft", "sent"] } },
    { $set: { status: "withdrawn", updatedAt: at }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
  return withdrawn ? { ok: true, quote: withdrawn } : explain(db, id, ["draft", "sent"]);
}

export async function getQuote(db: Db, id: ObjectId): Promise<QuoteDoc | null> {
  return quotes(db).findOne({ _id: id });
}

// The client's view: sent, answered or withdrawn quotes (a draft's link shows it is being updated).
export async function quoteByPublicId(db: Db, publicId: string): Promise<QuoteDoc | null> {
  return quotes(db).findOne({ publicId });
}

export async function markQuoteViewed(db: Db, id: ObjectId, at: Date = now()): Promise<void> {
  await quotes(db).updateOne({ _id: id, viewedAt: null, status: "sent" }, { $set: { viewedAt: at } });
}

export type AnswerProblem = { ok: false; problem: "missing" | "changed" | "expired" | "answered" };
export type Answer = { ok: true; quote: QuoteDoc } | AnswerProblem;

// Why a client's answer did not go through, for the message they see.
async function answerProblem(
  db: Db,
  publicId: string,
  version: number,
  today: string,
): Promise<AnswerProblem> {
  const current = await quotes(db).findOne({ publicId });
  if (!current || current.status === "draft" || current.status === "withdrawn")
    return { ok: false, problem: "missing" };
  if (current.status !== "sent") return { ok: false, problem: "answered" };
  if (current.validUntil !== null && current.validUntil < today) return { ok: false, problem: "expired" };
  return { ok: false, problem: current.version === version ? "missing" : "changed" };
}

export async function declineQuote(
  db: Db,
  publicId: string,
  version: number,
  reason: string | null,
  today: string,
  at: Date = now(),
): Promise<Answer> {
  const declined = await quotes(db).findOneAndUpdate(
    { publicId, version, status: "sent", validUntil: { $gte: today } },
    {
      $set: { status: "declined", answeredAt: at, declineReason: reason, updatedAt: at },
      $inc: { version: 1 },
    },
    { returnDocument: "after" },
  );
  return declined ? { ok: true, quote: declined } : answerProblem(db, publicId, version, today);
}

export type Accepted = { ok: true; quote: QuoteDoc; project: ProjectDoc; invoice: InvoiceDoc | null };

// The quote's client was deleted (at their request, say): the quote can't be accepted any more.
class ClientGoneError extends Error {}

// The client accepts the version they read. In one transaction: the quote is accepted, a project is made with
// its price, rounds and payment milestones, and the first payment is invoiced.
export async function acceptQuote(
  db: Db,
  publicId: string,
  version: number,
  by: { name: string; ip: string | null },
  settings: BillingSettings,
  today: string,
  at: Date = now(),
): Promise<Accepted | AnswerProblem> {
  let accepted;
  try {
    accepted = await inTransaction(db, async (session) => {
      const quote = await quotes(db).findOneAndUpdate(
        { publicId, version, status: "sent", validUntil: { $gte: today } },
        { $set: { status: "accepted", answeredAt: at, acceptedBy: by, updatedAt: at }, $inc: { version: 1 } },
        { session, returnDocument: "after" },
      );
      if (!quote) return null;
      const taxableMinor = quote.totals.subtotalMinor - quote.totals.discountMinor;
      const shares = splitSchedule(taxableMinor, quote.schedule);
      const project = await createProject(
        db,
        {
          clientId: quote.clientId,
          title: quote.title,
          service: null,
          summary: [`From ${quote.number}, accepted by ${by.name}.`, quote.notes]
            .filter(Boolean)
            .join("\n\n"),
          startDate: null,
          dueDate: null,
          estimateSeconds: null,
          currency: quote.currency,
          pricing: "fixed",
          budget: money(quote.totals.totalMinor, quote.currency),
          hourlyRate: null,
          revisionPolicy: {
            included: quote.revisionsIncluded,
            extraPrice:
              quote.extraRevisionMinor === null ? null : money(quote.extraRevisionMinor, quote.currency),
          },
          tags: [],
        },
        {
          stage: "planned",
          inquiryId: quote.inquiryId,
          // The payments after the first one, to invoice as the work reaches them.
          milestones: quote.schedule.slice(1).map((step) => ({
            id: randomUUID(),
            title: `Invoice: ${step.label} (${formatPercent(step.basisPoints)})`,
            dueDate: null,
            done: false,
            doneAt: null,
          })),
          session,
        },
        at,
      );
      if (!project) throw new ClientGoneError();
      const first = quote.schedule[0]!;
      const invoice = await createIssuedInvoice(
        db,
        {
          title: `${first.label}: ${quote.title}`,
          clientId: quote.clientId,
          projectId: project._id,
          recipient: quote.recipient,
          currency: quote.currency,
          lines: [
            {
              id: randomUUID(),
              description: `${first.label} (${formatPercent(first.basisPoints)}) of ${quote.number}: ${quote.title}`,
              quantityMilli: 1000,
              unitMinor: shares[0]!,
            },
          ],
          discount: null,
          taxes: quote.taxes,
          notes: "",
          methods: settings.methods,
        },
        { quoteId: quote._id },
        settings,
        today,
        session,
        at,
      );
      const linked = await quotes(db).findOneAndUpdate(
        { _id: quote._id },
        { $set: { projectId: project._id, depositInvoiceId: invoice._id } },
        { session, returnDocument: "after" },
      );
      return { quote: linked!, project, invoice };
    });
  } catch (error) {
    if (error instanceof ClientGoneError) return { ok: false, problem: "missing" };
    throw error;
  }
  if (!accepted) return answerProblem(db, publicId, version, today);
  return { ok: true, ...accepted };
}

export const QUOTE_VIEWS = ["open", "drafts", "answered", "all"] as const;
export type QuoteView = (typeof QUOTE_VIEWS)[number];

const VIEW_FILTERS: Record<QuoteView, Filter<QuoteDoc>> = {
  open: { status: "sent" },
  drafts: { status: "draft" },
  answered: { status: { $in: ["accepted", "declined", "withdrawn"] } },
  all: {},
};

export async function listQuotes(
  db: Db,
  { view = "open", clientId }: { view?: QuoteView; clientId?: ObjectId } = {},
): Promise<QuoteDoc[]> {
  const filter: Filter<QuoteDoc> = { ...VIEW_FILTERS[view] };
  if (clientId) filter.clientId = clientId;
  return quotes(db).find(filter).sort({ updatedAt: -1 }).limit(500).toArray();
}

// How many quotes each list holds.
export async function quoteCounts(db: Db): Promise<Record<QuoteView, number>> {
  const rows = await quotes(db)
    .aggregate<{ _id: QuoteStatus; count: number }>([{ $group: { _id: "$status", count: { $sum: 1 } } }])
    .toArray();
  const by = (status: QuoteStatus) => rows.find((row) => row._id === status)?.count ?? 0;
  return {
    open: by("sent"),
    drafts: by("draft"),
    answered: by("accepted") + by("declined") + by("withdrawn"),
    all: rows.reduce((sum, row) => sum + row.count, 0),
  };
}
