import "server-only";
import { MongoServerError, ObjectId, type ClientSession, type Db, type Filter } from "mongodb";
import { amountLeft } from "@/lib/billing/document";
import type { PaymentStatus } from "@/lib/billing/options";
import { invoices, payments } from "@/server/billing/collections";
import type { InvoiceDoc, PaymentDoc } from "@/server/billing/types";
import { now } from "@/server/clock";
import { inTransaction } from "@/server/db/transaction";

// Payments against invoices. A confirmed payment and its invoice's paid amount change together, in one
// transaction; the invoice is paid once they cover its total. Crypto checkouts start "pending" and are moved
// on only by the provider's verified status (see nowpayments.ts); anything odd goes to the owner's review.

const DUPLICATE_KEY = 11000;
const CHECKOUT_LIFETIME_MS = 24 * 3600_000;
const STUCK_CHECKOUT_MS = 2 * 60_000;

export type PaymentResult =
  | { ok: true; payment: PaymentDoc; invoice: InvoiceDoc }
  | { ok: false; reason: "missing" | "invalid" | "conflict"; message: string };

export { amountLeft };

// Paid and credited together, in an update pipeline (older invoices may lack creditedMinor).
const SETTLED = { $add: ["$paidMinor", { $ifNull: ["$creditedMinor", 0] }] };

// Adds a confirmed amount to an issued invoice; it becomes paid once payments and credit notes cover it. Null
// when the invoice is not issued any more (paid, or void), or when the amount is more than what's left to pay.
async function credit(
  db: Db,
  invoiceId: ObjectId,
  amountMinor: number,
  at: Date,
  session: ClientSession,
): Promise<InvoiceDoc | null> {
  return invoices(db).findOneAndUpdate(
    {
      _id: invoiceId,
      status: "issued",
      kind: "invoice",
      $expr: { $lte: [{ $add: [SETTLED, amountMinor] }, "$totals.totalMinor"] },
    },
    [
      {
        $set: {
          paidMinor: { $add: ["$paidMinor", amountMinor] },
          updatedAt: at,
          version: { $add: ["$version", 1] },
        },
      },
      {
        $set: {
          status: { $cond: [{ $gte: [SETTLED, "$totals.totalMinor"] }, "paid", "$status"] },
          paidAt: { $cond: [{ $gte: [SETTLED, "$totals.totalMinor"] }, at, "$paidAt"] },
        },
      },
    ],
    { session, returnDocument: "after" },
  );
}

// A bank transfer the owner saw arrive, recorded by hand.
export async function recordBankPayment(
  db: Db,
  invoiceId: ObjectId,
  input: { amountMinor: number; receivedOn: string; reference: string },
  at: Date = now(),
): Promise<PaymentResult> {
  return inTransaction(db, async (session) => {
    const invoice = await invoices(db).findOne({ _id: invoiceId }, { session });
    if (!invoice) return { ok: false, reason: "missing", message: "This invoice no longer exists." };
    if (invoice.status !== "issued" || invoice.kind !== "invoice") {
      return { ok: false, reason: "invalid", message: "Only an unpaid invoice can take a payment." };
    }
    const left = amountLeft(invoice);
    if (input.amountMinor <= 0 || input.amountMinor > left) {
      return {
        ok: false,
        reason: "invalid",
        message: "The amount has to be above zero and at most what's left to pay.",
      };
    }
    const payment: PaymentDoc = {
      _id: new ObjectId(),
      invoiceId,
      method: "bank",
      status: "confirmed",
      amountMinor: input.amountMinor,
      currency: invoice.currency,
      provider: null,
      receivedOn: input.receivedOn,
      reference: input.reference,
      reviewReason: null,
      confirmedAt: at,
      createdAt: at,
      updatedAt: at,
    };
    await payments(db).insertOne(payment, { session });
    const credited = await credit(db, invoiceId, input.amountMinor, at, session);
    if (!credited) throw new Error("The invoice changed during the payment.");
    return { ok: true, payment, invoice: credited };
  });
}

// --- Crypto checkouts ------------------------------------------------------------------------------------------

// The open crypto checkout of an invoice, reused while it's recent and for the amount still due; otherwise a
// new one. A unique index allows one pending crypto checkout per invoice, so two clicks make one.
export async function openCryptoAttempt(
  db: Db,
  invoice: InvoiceDoc,
  at: Date = now(),
): Promise<{ payment: PaymentDoc; fresh: boolean }> {
  const left = amountLeft(invoice);
  const existing = await payments(db).findOne({
    invoiceId: invoice._id,
    method: "crypto",
    status: "pending",
  });
  if (existing) {
    const age = at.getTime() - existing.createdAt.getTime();
    // A checkout whose page was never made (the server stopped half way) doesn't block the next one for long.
    const stuck = !existing.provider && age > STUCK_CHECKOUT_MS;
    if (!stuck && existing.amountMinor === left && age < CHECKOUT_LIFETIME_MS) {
      return { payment: existing, fresh: false };
    }
    await payments(db).updateOne(
      { _id: existing._id, status: "pending" },
      { $set: { status: "failed", reviewReason: "Replaced by a newer checkout.", updatedAt: at } },
    );
  }
  const payment: PaymentDoc = {
    _id: new ObjectId(),
    invoiceId: invoice._id,
    method: "crypto",
    status: "pending",
    amountMinor: left,
    currency: invoice.currency,
    provider: null,
    receivedOn: null,
    reference: "",
    reviewReason: null,
    confirmedAt: null,
    createdAt: at,
    updatedAt: at,
  };
  try {
    await payments(db).insertOne(payment);
    return { payment, fresh: true };
  } catch (error) {
    if (!(error instanceof MongoServerError && error.code === DUPLICATE_KEY)) throw error;
    const winner = await payments(db).findOne({
      invoiceId: invoice._id,
      method: "crypto",
      status: "pending",
    });
    if (!winner) throw error;
    return { payment: winner, fresh: false };
  }
}

export async function setCheckout(
  db: Db,
  paymentId: ObjectId,
  checkout: { invoiceId: string; url: string },
  at: Date = now(),
): Promise<void> {
  await payments(db).updateOne(
    { _id: paymentId },
    {
      $set: {
        provider: {
          name: "nowpayments",
          invoiceId: checkout.invoiceId,
          paymentId: null,
          url: checkout.url,
          payCurrency: null,
          actuallyPaid: null,
          lastStatus: null,
        },
        updatedAt: at,
      },
    },
  );
}

export type ProviderUpdate = {
  status: Exclude<PaymentStatus, "refunded">;
  paymentId: string;
  payCurrency: string | null;
  actuallyPaid: string | null;
  lastStatus: string;
  reviewReason?: string;
};

export type ProviderOutcome =
  | { kind: "confirmed"; payment: PaymentDoc; invoice: InvoiceDoc }
  | { kind: "review" | "failed" | "pending"; payment: PaymentDoc }
  | { kind: "unchanged" };

// Applies a provider's verified status to its checkout. Forward only: a confirmed payment never goes back, and a
// confirmation credits the invoice exactly once. While nothing has arrived, the checkout follows whichever
// payment the client is making (NOWPayments makes a new one when they switch coins); once money has arrived,
// a different payment through the same checkout is kept apart for the owner to review. Money that doesn't fit
// the invoice (paid, void, or more than what's left) goes to review too.
export async function applyProviderStatus(
  db: Db,
  paymentId: ObjectId,
  update: ProviderUpdate,
  at: Date = now(),
): Promise<ProviderOutcome> {
  // A payment another record already follows (kept apart earlier) is that record's.
  const elsewhere = await payments(db).countDocuments({
    "provider.paymentId": update.paymentId,
    _id: { $ne: paymentId },
  });
  if (elsewhere) return keepApart(db, paymentId, update, at);
  try {
    return await applyToCheckout(db, paymentId, update, at);
  } catch (error) {
    // Two callbacks raced for the same payment id: the unique index let one through.
    if (error instanceof MongoServerError && error.code === DUPLICATE_KEY) {
      return keepApart(db, paymentId, update, at);
    }
    throw error;
  }
}

async function applyToCheckout(
  db: Db,
  paymentId: ObjectId,
  update: ProviderUpdate,
  at: Date,
): Promise<ProviderOutcome> {
  const provider = {
    $mergeObjects: [
      { name: "nowpayments", invoiceId: null, url: null },
      "$provider",
      {
        paymentId: { $literal: update.paymentId },
        payCurrency: { $literal: update.payCurrency },
        actuallyPaid: { $literal: update.actuallyPaid },
        lastStatus: { $literal: update.lastStatus },
      },
    ],
  };
  const open: Filter<PaymentDoc> = { status: { $in: ["pending", "failed"] } };
  const ownReview: Filter<PaymentDoc> = { status: "review", "provider.paymentId": update.paymentId };

  if (update.status === "confirmed") {
    const outcome = await inTransaction(db, async (session): Promise<ProviderOutcome | null> => {
      const payment = await payments(db).findOneAndUpdate(
        { _id: paymentId, $or: [open, ownReview] },
        [
          {
            $set: {
              provider,
              status: "confirmed",
              confirmedAt: at,
              reviewReason: null,
              updatedAt: at,
            },
          },
        ],
        { session, returnDocument: "after" },
      );
      if (!payment) return null;
      const invoice = await credit(db, payment.invoiceId, payment.amountMinor, at, session);
      if (invoice) return { kind: "confirmed", payment, invoice };
      const current = await invoices(db).findOne({ _id: payment.invoiceId }, { session });
      const reviewReason =
        current?.status === "issued" && current.kind === "invoice"
          ? "More than what's left to pay: the invoice was partly paid another way meanwhile."
          : "Received for an invoice that was no longer open.";
      const held = await payments(db).findOneAndUpdate(
        { _id: paymentId },
        { $set: { status: "review", confirmedAt: null, reviewReason } },
        { session, returnDocument: "after" },
      );
      return { kind: "review", payment: held! };
    });
    return outcome ?? keepApart(db, paymentId, update, at);
  }

  // A part payment reviews an open checkout, or updates its own review.
  if (update.status === "review") {
    const payment = await payments(db).findOneAndUpdate(
      { _id: paymentId, $or: [open, ownReview] },
      [{ $set: { provider, status: "review", reviewReason: update.reviewReason ?? null, updatedAt: at } }],
      { returnDocument: "after" },
    );
    return payment ? { kind: "review", payment } : keepApart(db, paymentId, update, at);
  }

  // Waiting moves only an open checkout; a failure only ends the payment the checkout is following.
  const filter: Filter<PaymentDoc> =
    update.status === "pending"
      ? { _id: paymentId, status: "pending" }
      : {
          _id: paymentId,
          status: "pending",
          $or: [{ "provider.paymentId": null }, { "provider.paymentId": update.paymentId }],
        };
  const payment = await payments(db).findOneAndUpdate(
    filter,
    [{ $set: { provider, status: update.status, reviewReason: update.reviewReason ?? null, updatedAt: at } }],
    { returnDocument: "after" },
  );
  return payment ? { kind: update.status, payment } : { kind: "unchanged" };
}

// Money for a checkout that already holds another payment's money: a record of its own, in review. One per
// provider payment (a unique index), updated as that payment moves on until the owner decides.
async function keepApart(
  db: Db,
  paymentId: ObjectId,
  update: ProviderUpdate,
  at: Date,
): Promise<ProviderOutcome> {
  const details = {
    "provider.payCurrency": update.payCurrency,
    "provider.actuallyPaid": update.actuallyPaid,
    "provider.lastStatus": update.lastStatus,
    updatedAt: at,
  };
  const known = await payments(db).findOneAndUpdate(
    { "provider.paymentId": update.paymentId, _id: { $ne: paymentId }, status: "review" },
    { $set: details },
    { returnDocument: "after" },
  );
  if (known) return { kind: "review", payment: known };
  // Followed by a record the owner has already decided on: nothing more to do.
  if (
    await payments(db).countDocuments({ "provider.paymentId": update.paymentId, _id: { $ne: paymentId } })
  ) {
    return { kind: "unchanged" };
  }
  const checkout = await payments(db).findOne({ _id: paymentId });
  if (
    !checkout ||
    checkout.provider?.paymentId === update.paymentId ||
    (checkout.status !== "confirmed" && checkout.status !== "review")
  ) {
    return { kind: "unchanged" };
  }
  const extra: PaymentDoc = {
    _id: new ObjectId(),
    invoiceId: checkout.invoiceId,
    method: "crypto",
    status: "review",
    amountMinor: checkout.amountMinor,
    currency: checkout.currency,
    provider: {
      name: "nowpayments",
      invoiceId: checkout.provider?.invoiceId ?? null,
      paymentId: update.paymentId,
      url: null,
      payCurrency: update.payCurrency,
      actuallyPaid: update.actuallyPaid,
      lastStatus: update.lastStatus,
    },
    receivedOn: null,
    reference: "",
    reviewReason: `A second payment arrived through the same checkout (NOWPayments: ${update.lastStatus}). Check it in NOWPayments: count what arrived, or refund it and mark it failed.`,
    confirmedAt: null,
    createdAt: at,
    updatedAt: at,
  };
  try {
    await payments(db).insertOne(extra);
    return { kind: "review", payment: extra };
  } catch (error) {
    if (!(error instanceof MongoServerError && error.code === DUPLICATE_KEY)) throw error;
    return { kind: "unchanged" };
  }
}

// --- The owner's decisions -------------------------------------------------------------------------------------

// A payment in review: confirmed for the amount that actually arrived, or marked failed.
export async function resolveReview(
  db: Db,
  paymentId: ObjectId,
  decision: { confirm: true; amountMinor: number } | { confirm: false },
  at: Date = now(),
): Promise<PaymentResult> {
  return inTransaction(db, async (session) => {
    const payment = await payments(db).findOne({ _id: paymentId, status: "review" }, { session });
    if (!payment)
      return { ok: false, reason: "conflict", message: "This payment is no longer waiting for review." };
    const invoice = await invoices(db).findOne({ _id: payment.invoiceId }, { session });
    if (!invoice) return { ok: false, reason: "missing", message: "Its invoice no longer exists." };
    if (!decision.confirm) {
      const failed = await payments(db).findOneAndUpdate(
        { _id: paymentId, status: "review" },
        { $set: { status: "failed", updatedAt: at } },
        { session, returnDocument: "after" },
      );
      return { ok: true, payment: failed!, invoice };
    }
    if (
      decision.amountMinor <= 0 ||
      decision.amountMinor > amountLeft(invoice) ||
      invoice.status !== "issued"
    ) {
      return {
        ok: false,
        reason: "invalid",
        message: "The amount has to be above zero and at most what's left to pay.",
      };
    }
    const confirmed = await payments(db).findOneAndUpdate(
      { _id: paymentId, status: "review" },
      {
        $set: {
          status: "confirmed",
          amountMinor: decision.amountMinor,
          confirmedAt: at,
          reviewReason: null,
          updatedAt: at,
        },
      },
      { session, returnDocument: "after" },
    );
    const credited = await credit(db, invoice._id, decision.amountMinor, at, session);
    if (!confirmed || !credited) throw new Error("The payment or its invoice changed during the review.");
    return { ok: true, payment: confirmed, invoice: credited };
  });
}

// A refund the owner made: the payment no longer counts, and a paid invoice is open again.
export async function refundPayment(
  db: Db,
  paymentId: ObjectId,
  note: string,
  at: Date = now(),
): Promise<PaymentResult> {
  return inTransaction(db, async (session) => {
    const payment = await payments(db).findOneAndUpdate(
      { _id: paymentId, status: "confirmed" },
      { $set: { status: "refunded", reviewReason: note, refundedAt: at, updatedAt: at } },
      { session, returnDocument: "after" },
    );
    if (!payment)
      return { ok: false, reason: "conflict", message: "Only a received payment can be refunded." };
    const invoice = await invoices(db).findOneAndUpdate(
      { _id: payment.invoiceId, paidMinor: { $gte: payment.amountMinor } },
      [
        {
          $set: {
            paidMinor: { $subtract: ["$paidMinor", payment.amountMinor] },
            updatedAt: at,
            version: { $add: ["$version", 1] },
          },
        },
        // Paid invoices owe money again, unless credit notes still cover what the refund took back.
        {
          $set: {
            status: {
              $cond: [
                { $and: [{ $eq: ["$status", "paid"] }, { $lt: [SETTLED, "$totals.totalMinor"] }] },
                "issued",
                "$status",
              ],
            },
            paidAt: {
              $cond: [
                { $and: [{ $eq: ["$status", "paid"] }, { $lt: [SETTLED, "$totals.totalMinor"] }] },
                null,
                "$paidAt",
              ],
            },
          },
        },
      ],
      { session, returnDocument: "after" },
    );
    if (!invoice) throw new Error("The invoice's paid amount doesn't cover this refund.");
    return { ok: true, payment, invoice };
  });
}

export async function getPayment(db: Db, id: ObjectId): Promise<PaymentDoc | null> {
  return payments(db).findOne({ _id: id });
}

export async function paymentsFor(db: Db, invoiceId: ObjectId): Promise<PaymentDoc[]> {
  return payments(db).find({ invoiceId }).sort({ createdAt: -1 }).limit(100).toArray();
}

export async function paymentsToReview(db: Db): Promise<PaymentDoc[]> {
  return payments(db).find({ status: "review" }).sort({ updatedAt: 1 }).limit(200).toArray();
}

export async function recentPayments(db: Db, limit = 50): Promise<PaymentDoc[]> {
  return payments(db)
    .find({ status: { $in: ["confirmed", "refunded"] } })
    .sort({ confirmedAt: -1, updatedAt: -1 })
    .limit(limit)
    .toArray();
}

export async function countReview(db: Db): Promise<number> {
  return payments(db).countDocuments({ status: "review" });
}
