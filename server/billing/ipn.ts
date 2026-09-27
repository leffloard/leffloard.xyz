import "server-only";
import { randomUUID } from "node:crypto";
import { MongoServerError, ObjectId, type Db } from "mongodb";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { todayIn } from "@/lib/intake/time";
import { payments } from "@/server/billing/collections";
import { getInvoice } from "@/server/billing/invoices";
import { alertPayment, emailReceipt, type BillingNotify } from "@/server/billing/notify";
import {
  fetchNowPayment,
  ipnSignatureValid,
  mapNowPaymentsStatus,
  minorUnits,
  type NowPaymentsConfig,
} from "@/server/billing/nowpayments";
import { applyProviderStatus, getPayment, type ProviderUpdate } from "@/server/billing/payments";
import { now } from "@/server/clock";
import { log } from "@/server/log";
import { DailyCap } from "@/server/security/memory-limit";

// NOWPayments' payment callbacks (IPN). Each is checked for its signature and stored before anything else, so
// a repeat is recognised; then the payment's status is read back from NOWPayments' API, matched against our
// checkout (order, amount, currency) and applied forward-only. A callback that failed, or whose handling
// stopped half way (a restart), is taken again when NOWPayments retries it; one still being handled asks
// NOWPayments to come back later. A job also re-reads the payments still pending, in case a callback never
// comes back (see reconcileCryptoPayments).

type EventDoc = {
  _id: string;
  provider: "nowpayments";
  receivedAt: Date;
  signatureOk: boolean;
  paymentId: string | null;
  status: string | null;
  outcome: string;
  detail: string | null;
  purgeAt: Date;
};

const KEEP_MS = 400 * 86_400_000; // a year and a bit: the trail of every payment
const KEEP_REJECTED_MS = 7 * 86_400_000;
// Forged or broken callbacks are logged for the owner to see, but only so many a day: they come from anyone,
// and each is a document in a small database.
const REJECTED_PER_DAY = 500;
const rejectedLog = new DailyCap(REJECTED_PER_DAY);
const LEASE_MS = 2 * 60_000; // a callback being handled for longer than this has stopped half way
const DUPLICATE_KEY = 11000;

export type IpnOutcome =
  "confirmed" | "review" | "pending" | "failed" | "ignored" | "duplicate" | "busy" | "rejected" | "error";
export type IpnResult = { status: number; outcome: IpnOutcome };

function events(db: Db) {
  return db.collection<EventDoc>("payment_events");
}

export async function handleNowPaymentsIpn(
  db: Db,
  raw: string,
  signature: string | null,
  config: NowPaymentsConfig,
  notify: BillingNotify,
  at: Date = now(),
): Promise<IpnResult> {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { status: 400, outcome: "rejected" };
  }
  const record = (body ?? {}) as Record<string, unknown>;
  const paymentId =
    typeof record.payment_id === "number" || typeof record.payment_id === "string"
      ? String(record.payment_id)
      : null;
  const status = typeof record.payment_status === "string" ? record.payment_status.slice(0, 40) : null;

  if (!ipnSignatureValid(body, signature, config.ipnSecret)) {
    const allowance = rejectedLog.take(todayIn(ADMIN_TIME_ZONE, at));
    if (allowance === "just-full") {
      log.warn({ limit: REJECTED_PER_DAY }, "NOWPayments: today's log of rejected callbacks is full");
    }
    if (allowance !== "allowed") return { status: 401, outcome: "rejected" };
    await events(db).insertOne({
      _id: `rejected:${randomUUID()}`,
      provider: "nowpayments",
      receivedAt: at,
      signatureOk: false,
      paymentId: paymentId?.slice(0, 24) ?? null,
      status,
      outcome: "rejected",
      detail: "The signature did not match.",
      purgeAt: new Date(at.getTime() + KEEP_REJECTED_MS),
    });
    return { status: 401, outcome: "rejected" };
  }
  if (!paymentId || !/^\d{1,20}$/.test(paymentId) || !status) return { status: 200, outcome: "ignored" };

  const updatedAt = typeof record.updated_at === "string" ? record.updated_at.slice(0, 40) : "";
  const key = `nowpayments:${paymentId}:${status}:${updatedAt}`;
  try {
    await events(db).insertOne({
      _id: key,
      provider: "nowpayments",
      receivedAt: at,
      signatureOk: true,
      paymentId,
      status,
      outcome: "received",
      detail: null,
      purgeAt: new Date(at.getTime() + KEEP_MS),
    });
  } catch (error) {
    if (!(error instanceof MongoServerError && error.code === DUPLICATE_KEY)) throw error;
    // Seen before: taken again if it failed, or if its handling stopped half way.
    const retry = await events(db).findOneAndUpdate(
      {
        _id: key,
        $or: [
          { outcome: "error" },
          { outcome: "received", receivedAt: { $lte: new Date(at.getTime() - LEASE_MS) } },
        ],
      },
      { $set: { outcome: "received", receivedAt: at } },
    );
    if (!retry) {
      const current = await events(db).findOne({ _id: key }, { projection: { outcome: 1 } });
      // Still being handled: NOWPayments tries again later, and the answer is then known.
      if (current?.outcome === "received") return { status: 503, outcome: "busy" };
      return { status: 200, outcome: "duplicate" };
    }
  }

  const settled = await settleNowPayment(db, paymentId, config, notify, at);
  await events(db).updateOne({ _id: key }, { $set: { outcome: settled.outcome, detail: settled.detail } });
  return { status: settled.outcome === "error" ? 500 : 200, outcome: settled.outcome };
}

type Settled = { outcome: IpnOutcome; detail: string | null };

// Reads a NOWPayments payment from its API and applies it to our checkout, telling the client and the owner
// when money arrived or needs a look. Safe to run again: states only move forward and every message has a
// dedupeKey.
export async function settleNowPayment(
  db: Db,
  paymentId: string,
  config: NowPaymentsConfig,
  notify: BillingNotify,
  at: Date = now(),
): Promise<Settled> {
  try {
    // The callback says when to look; the API says what happened.
    const payment = await fetchNowPayment(config, paymentId);
    const ours = /:([a-f0-9]{24})$/.exec(String(payment.order_id ?? ""))?.[1];
    const doc = ours ? await getPayment(db, new ObjectId(ours)) : null;
    if (!doc || doc.method !== "crypto")
      return { outcome: "ignored", detail: "No checkout of ours has this order." };
    const invoice = await getInvoice(db, doc.invoiceId);
    if (!invoice) return { outcome: "ignored", detail: "The invoice no longer exists." };

    const mapped = mapNowPaymentsStatus(payment.payment_status);
    const update: ProviderUpdate = {
      status: "pending",
      paymentId,
      payCurrency: payment.pay_currency ? String(payment.pay_currency).slice(0, 20) : null,
      actuallyPaid:
        payment.actually_paid !== null && payment.actually_paid !== undefined
          ? String(payment.actually_paid).slice(0, 40)
          : null,
      lastStatus: payment.payment_status.slice(0, 40),
    };
    const problems: string[] = [];
    if (payment.order_id !== `${invoice.number}:${doc._id.toHexString()}`)
      problems.push("the order doesn't match");
    if (
      doc.provider?.invoiceId &&
      payment.invoice_id != null &&
      String(payment.invoice_id) !== doc.provider.invoiceId
    ) {
      problems.push("NOWPayments' invoice id doesn't match");
    }
    if (minorUnits(payment.price_amount) !== doc.amountMinor)
      problems.push(`the amount is ${payment.price_amount}`);
    if (String(payment.price_currency).toUpperCase() !== doc.currency)
      problems.push(`the currency is ${payment.price_currency}`);

    if (problems.length) {
      update.status = "review";
      update.reviewReason = `NOWPayments reports ${payment.payment_status}, but ${problems.join(", ")}.`;
    } else if (mapped === "review") {
      update.status = "review";
      update.reviewReason =
        `Part paid: ${payment.actually_paid ?? "?"} of ${payment.pay_amount ?? "?"} ${payment.pay_currency ?? ""}. Check it in NOWPayments, then confirm what arrived or mark it failed.`.trim();
    } else if (mapped === "refunded") {
      update.status = "review";
      update.reviewReason = "NOWPayments reports this payment refunded.";
    } else if (mapped === null) {
      return { outcome: "ignored", detail: `Unknown status ${payment.payment_status}.` };
    } else {
      update.status = mapped;
    }

    const applied = await applyProviderStatus(db, doc._id, update, at);
    if (applied.kind === "confirmed") {
      await emailReceipt(db, applied.invoice, applied.payment, notify);
      await alertPayment(db, applied.invoice, applied.payment, "received", notify);
      return { outcome: "confirmed", detail: null };
    }
    if (applied.kind === "review") {
      await alertPayment(db, invoice, applied.payment, "review", notify);
      return { outcome: "review", detail: applied.payment.reviewReason };
    }
    if (applied.kind === "unchanged")
      return { outcome: "ignored", detail: "The payment had already moved on." };
    return { outcome: applied.kind, detail: null };
  } catch (error) {
    log.error({ err: error, paymentId }, "NOWPayments payment could not be settled");
    return { outcome: "error", detail: (error as Error).message.slice(0, 300) };
  }
}

// The job: checkouts still pending a while after NOWPayments last told us about them are read again from its
// API, so a payment whose callback was lost is still counted. (A checkout NOWPayments never called back about
// has no payment id to look up; those stay pending until the client pays or they're replaced.)
export async function reconcileCryptoPayments(
  db: Db,
  config: NowPaymentsConfig,
  notify: BillingNotify,
  at: Date = now(),
): Promise<{ checked: number; settled: number }> {
  const quiet = new Date(at.getTime() - 10 * 60_000);
  const since = new Date(at.getTime() - 7 * 86_400_000);
  const open = await payments(db)
    .find({
      method: "crypto",
      status: "pending",
      "provider.paymentId": { $type: "string" },
      updatedAt: { $lte: quiet },
      createdAt: { $gte: since },
    })
    .sort({ updatedAt: 1 })
    .limit(50)
    .toArray();
  let settled = 0;
  for (const doc of open) {
    const result = await settleNowPayment(db, doc.provider!.paymentId!, config, notify, at);
    if (result.outcome === "confirmed" || result.outcome === "review" || result.outcome === "failed")
      settled++;
    // Nothing changed: touched, so the next run looks at the others first.
    if (result.outcome === "pending" || result.outcome === "ignored") {
      await payments(db).updateOne({ _id: doc._id, status: "pending" }, { $set: { updatedAt: at } });
    }
  }
  return { checked: open.length, settled };
}
