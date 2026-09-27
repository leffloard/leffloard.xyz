import "server-only";
import type { Db } from "mongodb";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { addDays, wallDateTime } from "@/lib/intake/time";
import { invoices } from "@/server/billing/collections";
import { reminderEmail } from "@/server/billing/emails";
import { amountLeft } from "@/server/billing/payments";
import { getBillingSettings } from "@/server/billing/settings";
import type { BillingNotify } from "@/server/billing/notify";
import type { InvoiceDoc } from "@/server/billing/types";
import { now } from "@/server/clock";
import { dayOf } from "@/server/finance/days";
import { runJob, type JobOutcome } from "@/server/jobs/runner";
import { enqueue } from "@/server/notify/outbox";

// Friendly reminders of an unpaid invoice: a day, a week and two weeks after its due date, then no more.
// Each is claimed on the invoice before it's queued, so it goes out once, and never two within a few days
// (an invoice already long overdue when reminders start doesn't get all three at once).

export const REMINDER_DAYS = [1, 7, 14] as const; // days after the due date
const MIN_GAP_MS = 5 * 86_400_000;

// The day the next reminder is due, or null when none will be sent.
export function nextReminderOn(
  invoice: Pick<
    InvoiceDoc,
    "status" | "kind" | "dueDate" | "remindersSent" | "remindersPaused" | "recipient"
  >,
): string | null {
  if (invoice.status !== "issued" || invoice.kind !== "invoice" || !invoice.dueDate) return null;
  if (invoice.remindersPaused || !invoice.recipient.email) return null;
  const after = REMINDER_DAYS[invoice.remindersSent];
  return after === undefined ? null : addDays(invoice.dueDate, after);
}

export async function sendOverdueReminders(db: Db, notify: BillingNotify, at: Date = now()): Promise<number> {
  if (!notify.channels.email) return 0;
  const today = dayOf(at);
  const candidates = await invoices(db)
    .find({
      status: "issued",
      kind: "invoice",
      dueDate: { $lt: today },
      remindersSent: { $lt: REMINDER_DAYS.length },
      remindersPaused: { $ne: true },
      "recipient.email": { $type: "string" },
    })
    .sort({ dueDate: 1 })
    .limit(200)
    .toArray();
  const settings = await getBillingSettings(db);
  const context = {
    siteUrl: notify.siteUrl,
    ownerEmail: notify.channels.ownerEmail,
    seller: settings.business,
  };
  let sent = 0;
  for (const invoice of candidates) {
    const due = nextReminderOn(invoice);
    if (!due || due > today || amountLeft(invoice) <= 0) continue;
    if (invoice.lastReminderAt && at.getTime() - invoice.lastReminderAt.getTime() < MIN_GAP_MS) continue;
    const claimed = await invoices(db).findOneAndUpdate(
      {
        _id: invoice._id,
        status: "issued",
        remindersSent: invoice.remindersSent,
        remindersPaused: { $ne: true },
      },
      { $inc: { remindersSent: 1 }, $set: { lastReminderAt: at } },
      { returnDocument: "after" },
    );
    if (!claimed) continue;
    await enqueue(db, {
      channel: "email",
      payload: reminderEmail(claimed, context, claimed.remindersSent, today),
      dedupeKey: `invoice:${claimed._id.toHexString()}:reminder:${claimed.remindersSent}`,
      label: `Reminder ${claimed.remindersSent} for ${claimed.number} to ${claimed.recipient.name}`,
      ref: { invoiceId: claimed._id },
    });
    sent++;
  }
  return sent;
}

export async function setRemindersPaused(db: Db, id: InvoiceDoc["_id"], paused: boolean): Promise<boolean> {
  const updated = await invoices(db).updateOne(
    { _id: id, status: "issued", kind: "invoice" },
    { $set: { remindersPaused: paused } },
  );
  return updated.matchedCount === 1;
}

// Once a day, from 10:00.
export async function runRemindersJob(db: Db, notify: BillingNotify, at: Date = now()): Promise<JobOutcome> {
  const { date, time } = wallDateTime(at, ADMIN_TIME_ZONE);
  return runJob(
    db,
    "invoice-reminders",
    async () => `${await sendOverdueReminders(db, notify, at)} reminders queued`,
    { periodKey: time >= "10:00" ? date : null, lockMs: 10 * 60_000, retryAfterFailureMs: 30 * 60_000 },
  );
}
