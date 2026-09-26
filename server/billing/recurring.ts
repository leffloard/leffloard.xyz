import "server-only";
import { ObjectId, type Db } from "mongodb";
import { computeTotals } from "@/lib/billing/document";
import { nextOccurrence, periodLabel, withPeriod, type RecurringInterval } from "@/lib/billing/recurring";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { wallDateTime } from "@/lib/intake/time";
import { invoices, recurringInvoices } from "@/server/billing/collections";
import { checkIssue, createIssuedInvoice, type InvoiceInput } from "@/server/billing/invoices";
import { alertRecurringProblem, emailInvoice, type BillingNotify } from "@/server/billing/notify";
import { getBillingSettings } from "@/server/billing/settings";
import type { InvoiceDoc, RecurringInvoiceDoc } from "@/server/billing/types";
import { now } from "@/server/clock";
import { inTransaction } from "@/server/db/transaction";
import { dayOf } from "@/server/finance/days";
import { runJob, type JobOutcome } from "@/server/jobs/runner";
import { log } from "@/server/log";

// Recurring invoices: a plan (care, hosting) issues the same invoice every month, quarter or year and emails
// it to the client. The plan's next date moves on in the same transaction that issues the invoice, and an
// invoice records the plan and the date it covers under a unique index, so no period is billed twice.

export type RecurringInput = InvoiceInput & {
  interval: RecurringInterval;
  nextOn: string; // the next (or first) invoice's date
  endOn: string | null;
};

export type RecurringChange =
  | { ok: true; plan: RecurringInvoiceDoc }
  | { ok: false; reason: "missing" | "conflict" }
  | { ok: false; reason: "invalid"; message: string };

function planFields(input: RecurringInput, anchorDay: number) {
  const { interval, nextOn, endOn, ...content } = input;
  return {
    ...content,
    totals: computeTotals(content.lines, content.discount, content.taxes),
    interval,
    nextOn,
    endOn,
    anchorDay,
  };
}

const dayOfMonth = (date: string) => Number(date.slice(8, 10));

// The plan's first date on or after a day, or null once past its last date.
function upcoming(
  plan: Pick<RecurringInvoiceDoc, "interval" | "anchorDay" | "endOn">,
  from: string,
  day: string,
): string | null {
  let next = from;
  for (let step = 0; next < day && step < 1200; step++)
    next = nextOccurrence(next, plan.interval, plan.anchorDay);
  return plan.endOn !== null && next > plan.endOn ? null : next;
}

async function alreadyBilled(db: Db, id: ObjectId, period: string): Promise<InvoiceDoc | null> {
  return invoices(db).findOne({ recurringId: id, period }, { projection: { number: 1 } });
}

export async function createRecurring(
  db: Db,
  input: RecurringInput,
  at: Date = now(),
): Promise<RecurringInvoiceDoc> {
  const doc: RecurringInvoiceDoc = {
    _id: new ObjectId(),
    ...planFields(input, dayOfMonth(input.nextOn)),
    active: true,
    issuedCount: 0,
    lastIssuedOn: null,
    lastInvoiceId: null,
    lastError: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
  await recurringInvoices(db).insertOne(doc);
  return doc;
}

async function explain(db: Db, id: ObjectId): Promise<RecurringChange> {
  return {
    ok: false,
    reason: (await recurringInvoices(db).countDocuments({ _id: id })) ? "conflict" : "missing",
  };
}

// A changed plan applies from its next invoice; the ones already issued stay as they are. A paused plan stays
// paused; one that had ended starts again from its new date. The day of the month invoices fall on changes
// only when the date does (so a plan on the 31st isn't moved to the 28th by an edit in February).
export async function updateRecurring(
  db: Db,
  id: ObjectId,
  version: number,
  input: RecurringInput,
  at: Date = now(),
): Promise<RecurringChange> {
  const current = await recurringInvoices(db).findOne({ _id: id, version });
  if (!current) return explain(db, id);
  const billed = await alreadyBilled(db, id, input.nextOn);
  if (billed) {
    return {
      ok: false,
      reason: "invalid",
      message: `${billed.number} already covers that date. To bill it again, make a one-off invoice.`,
    };
  }
  const anchorDay = input.nextOn === current.nextOn ? current.anchorDay : dayOfMonth(input.nextOn);
  const updated = await recurringInvoices(db).findOneAndUpdate(
    { _id: id, version },
    {
      $set: {
        ...planFields(input, anchorDay),
        active: current.nextOn === null ? true : current.active,
        lastError: null,
        updatedAt: at,
      },
      $inc: { version: 1 },
    },
    { returnDocument: "after" },
  );
  return updated ? { ok: true, plan: updated } : explain(db, id);
}

// Pausing stops the invoices; resuming starts again from the plan's next date on or after today, so the
// months it was paused are not billed. A plan that ended (no next date) needs a new date instead.
export async function setRecurringActive(
  db: Db,
  id: ObjectId,
  version: number,
  active: boolean,
  at: Date = now(),
): Promise<RecurringChange> {
  const current = await recurringInvoices(db).findOne({ _id: id, version });
  if (!current) return explain(db, id);
  let nextOn = current.nextOn;
  if (active) {
    if (!nextOn) {
      return {
        ok: false,
        reason: "invalid",
        message: "This plan has ended: set its next date to start it again.",
      };
    }
    nextOn = upcoming(current, nextOn, dayOf(at));
    if (!nextOn) return { ok: false, reason: "invalid", message: "This plan's last date has passed." };
  }
  const updated = await recurringInvoices(db).findOneAndUpdate(
    { _id: id, version },
    { $set: { active, nextOn, updatedAt: at }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
  return updated ? { ok: true, plan: updated } : explain(db, id);
}

export async function deleteRecurring(db: Db, id: ObjectId): Promise<boolean> {
  return (await recurringInvoices(db).deleteOne({ _id: id })).deletedCount === 1;
}

export async function getRecurring(db: Db, id: ObjectId): Promise<RecurringInvoiceDoc | null> {
  return recurringInvoices(db).findOne({ _id: id });
}

export async function listRecurring(db: Db): Promise<RecurringInvoiceDoc[]> {
  return recurringInvoices(db).find().sort({ active: -1, nextOn: 1, createdAt: -1 }).limit(500).toArray();
}

export async function invoicesOfPlan(db: Db, id: ObjectId): Promise<InvoiceDoc[]> {
  return invoices(db).find({ recurringId: id }).sort({ createdAt: -1 }).limit(24).toArray();
}

export type IssueOutcome =
  | { ok: true; invoice: InvoiceDoc; emailed: boolean }
  | { ok: false; reason: "missing" | "conflict" | "invalid"; message: string };

// Issues the plan's next invoice (dated today, covering the plan's date) and emails it to the client.
export async function issueNext(
  db: Db,
  plan: RecurringInvoiceDoc,
  notify: BillingNotify,
  at: Date = now(),
): Promise<IssueOutcome> {
  const period = plan.nextOn;
  if (!plan.active || !period) {
    return { ok: false, reason: "conflict", message: "This plan has ended or is paused." };
  }
  const today = dayOf(at);
  const settings = await getBillingSettings(db);
  const label = periodLabel(period, plan.interval);
  const input: InvoiceInput = {
    title: withPeriod(plan.title, label),
    clientId: plan.clientId,
    projectId: plan.projectId,
    recipient: plan.recipient,
    currency: plan.currency,
    lines: plan.lines.map((line) => ({ ...line, description: withPeriod(line.description, label) })),
    discount: plan.discount,
    taxes: plan.taxes,
    notes: withPeriod(plan.notes, label),
    methods: plan.methods,
  };
  const check = checkIssue({ kind: "invoice", ...plan }, settings);
  if (!check.ok) return problem(db, plan, check.message, notify, at);
  const billed = await alreadyBilled(db, plan._id, period);
  if (billed) {
    return problem(
      db,
      plan,
      `${billed.number} already covers ${label}. Set the plan's next date, or make a one-off invoice.`,
      notify,
      at,
    );
  }

  const invoice = await inTransaction(db, async (session) => {
    const next = nextOccurrence(period, plan.interval, plan.anchorDay);
    const ended = plan.endOn !== null && next > plan.endOn;
    const advanced = await recurringInvoices(db).findOneAndUpdate(
      { _id: plan._id, version: plan.version, nextOn: period, active: true },
      {
        $set: {
          nextOn: ended ? null : next,
          active: !ended,
          lastIssuedOn: today,
          lastError: null,
          updatedAt: at,
        },
        $inc: { issuedCount: 1, version: 1 },
      },
      { session, returnDocument: "after" },
    );
    if (!advanced) return null;
    const issued = await createIssuedInvoice(
      db,
      input,
      { quoteId: null, recurringId: plan._id, period },
      settings,
      today,
      session,
      at,
    );
    await recurringInvoices(db).updateOne(
      { _id: plan._id },
      { $set: { lastInvoiceId: issued._id } },
      { session },
    );
    return issued;
  });
  if (!invoice) {
    return {
      ok: false,
      reason: "conflict",
      message: "This plan changed or was issued somewhere else. Reload to see it.",
    };
  }
  const emailed = await emailInvoice(db, invoice, notify, { again: false, at });
  return { ok: true, invoice, emailed };
}

// A plan that can't be issued: the reason is kept on it, the owner is told once, and it is tried again later.
async function problem(
  db: Db,
  plan: RecurringInvoiceDoc,
  message: string,
  notify: BillingNotify,
  at: Date,
): Promise<IssueOutcome> {
  await recurringInvoices(db).updateOne(
    { _id: plan._id, nextOn: plan.nextOn },
    { $set: { lastError: message, updatedAt: at } },
  );
  await alertRecurringProblem(db, plan, message, notify);
  return { ok: false, reason: "invalid", message };
}

// The job: every active plan whose date has come, one invoice each per run (a plan more than one period
// behind catches up on the next runs). One plan's trouble never holds up the others.
export async function issueDueRecurring(
  db: Db,
  notify: BillingNotify,
  at: Date = now(),
): Promise<{ issued: number; failed: number }> {
  const due = await recurringInvoices(db)
    .find({ active: true, nextOn: { $lte: dayOf(at) } })
    .sort({ nextOn: 1 })
    .limit(50)
    .toArray();
  let issued = 0;
  let failed = 0;
  for (const plan of due) {
    try {
      const outcome = await issueNext(db, plan, notify, at);
      if (outcome.ok) issued++;
      else if (outcome.reason === "invalid") failed++;
    } catch (error) {
      log.error({ err: error, plan: plan._id.toHexString() }, "recurring invoice failed");
      await problem(db, plan, "Something went wrong while issuing it; it is tried again later.", notify, at);
      failed++;
    }
  }
  return { issued, failed };
}

// Invoices go out during the day, not in the middle of the night.
export async function runRecurringJob(
  db: Db,
  notify: BillingNotify,
  at: Date = now(),
): Promise<JobOutcome | null> {
  const { time } = wallDateTime(at, ADMIN_TIME_ZONE);
  if (time < "09:00" || time >= "21:00") return null;
  return runJob(
    db,
    "recurring-invoices",
    async () => {
      const result = await issueDueRecurring(db, notify, at);
      return `${result.issued} issued${result.failed ? `, ${result.failed} could not be` : ""}`;
    },
    { lockMs: 10 * 60_000, retryAfterFailureMs: 15 * 60_000 },
  );
}
