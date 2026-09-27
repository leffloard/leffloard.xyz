"use server";

import { ObjectId } from "mongodb";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fail, ok } from "@/lib/action-result";
import { parseAmount } from "@/lib/money";
import { computeTotals, SCHEDULES } from "@/lib/billing/document";
import { RECURRING_INTERVALS } from "@/lib/billing/recurring";
import { bankAccountSchema, billingProfileSchema, invoiceSchema, quoteSchema } from "@/lib/billing/forms";
import { ADMIN_TIME_ZONE, formatDateTime } from "@/lib/format";
import { dateSchema, fieldError, idSchema, text } from "@/lib/forms";
import { todayIn } from "@/lib/intake/time";
import { adminAction } from "@/server/auth/action";
import { audit } from "@/server/auth/audit";
import {
  checkIssue,
  createInvoice,
  deleteDraftInvoice,
  draftCreditNote,
  getInvoice,
  issueInvoice,
  updateInvoice,
  voidInvoice,
  type InvoiceChange,
  type InvoiceInput,
} from "@/server/billing/invoices";
import {
  createQuote,
  deleteDraftQuote,
  getQuote,
  reopenQuote,
  sendQuote,
  updateQuote,
  withdrawQuote,
  type QuoteChange,
  type QuoteInput,
} from "@/server/billing/quotes";
import {
  getBillingSettings,
  saveBankAccounts,
  saveBillingProfile,
  StaleBillingError,
} from "@/server/billing/settings";
import { emailInvoice, emailQuote, emailReceipt } from "@/server/billing/notify";
import { recordBankPayment, refundPayment, resolveReview } from "@/server/billing/payments";
import {
  createRecurring,
  deleteRecurring,
  getRecurring,
  issueNext,
  setRecurringActive,
  updateRecurring,
  type RecurringChange,
  type RecurringInput,
} from "@/server/billing/recurring";
import { payableMethods } from "@/server/billing/providers";
import { setRemindersPaused } from "@/server/billing/reminders";
import { longDate } from "@/server/billing/view";
import { notifyContext } from "@/server/calendar/public";
import { getClient } from "@/server/clients/store";
import { now } from "@/server/clock";
import { readChannels } from "@/server/notify/channels";
import { sendQueuedSoon } from "@/server/notify/kick";
import { enqueue } from "@/server/notify/outbox";
import { getProject } from "@/server/projects/store";

const versionSchema = z.number().int().min(0);
const today = () => todayIn(ADMIN_TIME_ZONE, now());

const QUOTE_PROBLEMS: Record<Exclude<QuoteChange, { ok: true }>["reason"], string> = {
  missing: "This quote no longer exists.",
  conflict: "This quote was changed somewhere else. Reload to see it.",
  locked: "This quote was sent or answered meanwhile. Reload to see it.",
  invalid: "The quote can't be sent yet.",
};

const INVOICE_PROBLEMS: Record<Exclude<InvoiceChange, { ok: true }>["reason"], string> = {
  missing: "This invoice no longer exists.",
  conflict: "This invoice was changed somewhere else. Reload to see it.",
  locked: "This invoice was issued meanwhile, so it can't change. Reload to see it.",
  invalid: "The invoice can't be issued yet.",
};

function quoteProblem(result: Exclude<QuoteChange, { ok: true }>) {
  return fail(result.message ?? QUOTE_PROBLEMS[result.reason]);
}

function invoiceProblem(result: Exclude<InvoiceChange, { ok: true }>) {
  return fail(result.message ?? INVOICE_PROBLEMS[result.reason]);
}

// A document's total over the limit is a mistake in the lines, not a crash.
function tooLarge(error: unknown) {
  if (error instanceof RangeError)
    return fieldError("lines", "The total is too large: check the quantities and prices.");
  throw error;
}

function lines(input: z.infer<typeof quoteSchema> | z.infer<typeof invoiceSchema>) {
  return input.lines.map((line) => ({
    id: line.id,
    description: line.description,
    quantityMilli: line.quantity,
    unitMinor: line.unitPrice,
  }));
}

function documentFields(input: z.infer<typeof quoteSchema> | z.infer<typeof invoiceSchema>) {
  return {
    title: input.title,
    recipient: {
      name: input.recipient.name,
      company: input.recipient.company,
      email: input.recipient.email,
      address: input.recipient.address,
    },
    currency: input.currency,
    lines: lines(input),
    discount: input.discount,
    taxes: input.taxes.map((tax) => ({ label: tax.label, basisPoints: tax.percent })),
    notes: input.notes,
  };
}

// --- Quotes ----------------------------------------------------------------------------------------------------

export const saveQuoteAction = adminAction(
  quoteSchema.extend({ id: z.string().regex(/^(?:[a-f0-9]{24})?$/), version: versionSchema }),
  async (input, { db }) => {
    const clientId = new ObjectId(input.clientId);
    if (!(await getClient(db, clientId))) return fieldError("clientId", "That client no longer exists.");
    const quote: QuoteInput = {
      ...documentFields(input),
      clientId,
      inquiryId: input.inquiryId ? new ObjectId(input.inquiryId) : null,
      schedule: [...SCHEDULES[input.schedule].steps],
      timeline: input.timeline ?? "",
      revisionsIncluded: input.revisionsIncluded,
      extraRevisionMinor: input.extraRevisionPrice,
    };
    let id: ObjectId;
    try {
      if (!input.id) {
        id = (await createQuote(db, quote))._id;
      } else {
        const saved = await updateQuote(db, new ObjectId(input.id), input.version, quote);
        if (!saved.ok) return quoteProblem(saved);
        refresh();
        return ok(null, "Saved.");
      }
    } catch (error) {
      return tooLarge(error);
    }
    redirect(`/admin/billing/quotes/${id.toHexString()}`);
  },
);

export const sendQuoteAction = adminAction(
  z.object({ id: idSchema, version: versionSchema }),
  async (input, { db }) => {
    const settings = await getBillingSettings(db);
    // Accepting it issues the first invoice at once: it has to be payable.
    const draft = await getQuote(db, new ObjectId(input.id));
    if (draft && !payableMethods(settings, draft.currency).length) {
      return fail(
        `The first invoice would have no way to pay: add a bank account that takes ${draft.currency} in the billing settings, or set up crypto payments.`,
      );
    }
    const sent = await sendQuote(db, new ObjectId(input.id), input.version, settings, today());
    if (!sent.ok) return quoteProblem(sent);
    const emailed = await emailQuote(db, sent.quote, notifyContext(), now());
    if (emailed) sendQueuedSoon();
    refresh();
    return ok(
      null,
      emailed
        ? `${sent.quote.number} is on its way to ${sent.quote.recipient.email}.`
        : `${sent.quote.number} is ready. Email isn't set up, so copy its link for the client.`,
    );
  },
);

export const emailQuoteAgainAction = adminAction(z.object({ id: idSchema }), async (input, { db }) => {
  const quote = await getQuote(db, new ObjectId(input.id));
  if (!quote || quote.status !== "sent") return fail("Only a sent quote can be emailed.");
  if (!(await emailQuote(db, quote, notifyContext(), now()))) {
    return fail("Email isn't set up, or the quote has no address.");
  }
  sendQueuedSoon();
  return ok(null, `Emailed to ${quote.recipient.email} again.`);
});

export const reopenQuoteAction = adminAction(
  z.object({ id: idSchema, version: versionSchema }),
  async (input, { db }) => {
    const reopened = await reopenQuote(db, new ObjectId(input.id), input.version);
    if (!reopened.ok) return quoteProblem(reopened);
    refresh();
    return ok(null, "Back to a draft. Its link says it's being updated until you send it again.");
  },
);

export const withdrawQuoteAction = adminAction(
  z.object({ id: idSchema, version: versionSchema }),
  async (input, { db }) => {
    const withdrawn = await withdrawQuote(db, new ObjectId(input.id), input.version);
    if (!withdrawn.ok) return quoteProblem(withdrawn);
    refresh();
    return ok(null, "Withdrawn. The client can no longer accept it.");
  },
);

export const deleteQuoteAction = adminAction(z.object({ id: idSchema }), async (input, { db }) => {
  if (!(await deleteDraftQuote(db, new ObjectId(input.id)))) {
    return fail("Only a quote that was never sent can be deleted. Withdraw this one instead.");
  }
  redirect("/admin/billing/quotes?view=drafts");
});

// --- Invoices --------------------------------------------------------------------------------------------------

export const saveInvoiceAction = adminAction(
  invoiceSchema.extend({ id: z.string().regex(/^(?:[a-f0-9]{24})?$/), version: versionSchema }),
  async (input, { db }) => {
    const clientId = input.clientId ? new ObjectId(input.clientId) : null;
    if (clientId && !(await getClient(db, clientId)))
      return fieldError("clientId", "That client no longer exists.");
    const projectId = input.projectId ? new ObjectId(input.projectId) : null;
    if (projectId && !(await getProject(db, projectId)))
      return fieldError("projectId", "That project no longer exists.");
    const invoice: InvoiceInput = { ...documentFields(input), clientId, projectId, methods: input.methods };
    let id: ObjectId;
    try {
      if (!input.id) {
        id = (await createInvoice(db, invoice))._id;
      } else {
        const saved = await updateInvoice(db, new ObjectId(input.id), input.version, invoice);
        if (!saved.ok) return invoiceProblem(saved);
        refresh();
        return ok(null, "Saved.");
      }
    } catch (error) {
      return tooLarge(error);
    }
    redirect(`/admin/billing/invoices/${id.toHexString()}`);
  },
);

export const issueInvoiceAction = adminAction(
  z.object({ id: idSchema, version: versionSchema }),
  async (input, { db }) => {
    const settings = await getBillingSettings(db);
    const issued = await issueInvoice(db, new ObjectId(input.id), input.version, settings, today());
    if (!issued.ok) return invoiceProblem(issued);
    const emailed = await emailInvoice(db, issued.invoice, notifyContext(), { again: false, at: now() });
    if (emailed) sendQueuedSoon();
    refresh();
    if (issued.invoice.kind === "credit") return ok(null, `${issued.invoice.number} is issued.`);
    return ok(
      null,
      emailed
        ? `${issued.invoice.number} is issued and on its way to ${issued.invoice.recipient.email}.`
        : `${issued.invoice.number} is issued. Email isn't set up (or there's no address): copy its link for the client.`,
    );
  },
);

export const emailInvoiceAgainAction = adminAction(z.object({ id: idSchema }), async (input, { db }) => {
  const invoice = await getInvoice(db, new ObjectId(input.id));
  if (!invoice || invoice.status !== "issued" || invoice.kind !== "invoice") {
    return fail("Only an unpaid invoice can be sent again.");
  }
  if (!(await emailInvoice(db, invoice, notifyContext(), { again: true, at: now() }))) {
    return fail("Email isn't set up, or the invoice has no address.");
  }
  sendQueuedSoon();
  return ok(null, `Reminder sent to ${invoice.recipient.email}.`);
});

// Voiding changes the books, so it asks to confirm it's you and is written to the audit log.
export const voidInvoiceAction = adminAction(
  z.object({
    id: idSchema,
    version: versionSchema,
    reason: text({ maxLength: 500, required: true, requiredMessage: "Say why, for the record." }),
  }),
  async (input, { db, user, client }) => {
    const voided = await voidInvoice(db, new ObjectId(input.id), input.version, input.reason!);
    if (!voided.ok) return invoiceProblem(voided);
    await audit(db, {
      action: "billing.invoice.voided",
      actorId: user._id,
      ip: client.ip,
      userAgent: client.userAgent,
      details: { invoice: voided.invoice.number },
    });
    refresh();
    return ok(null, `${voided.invoice.number} is void.`);
  },
  { sudo: true },
);

export const creditNoteAction = adminAction(z.object({ id: idSchema }), async (input, { db }) => {
  const credit = await draftCreditNote(db, new ObjectId(input.id));
  if (!credit) return fail("A credit note corrects an issued or paid invoice.");
  redirect(`/admin/billing/invoices/${credit._id.toHexString()}`);
});

export const deleteInvoiceAction = adminAction(z.object({ id: idSchema }), async (input, { db }) => {
  if (!(await deleteDraftInvoice(db, new ObjectId(input.id)))) return fail("Only a draft can be deleted.");
  redirect("/admin/billing/invoices?view=drafts");
});

// --- Recurring invoices ----------------------------------------------------------------------------------------

const RECURRING_PROBLEMS = {
  missing: "This plan no longer exists.",
  conflict: "This plan was changed somewhere else. Reload to see it.",
};

function recurringProblem(result: Exclude<RecurringChange, { ok: true }>) {
  return result.reason === "invalid" ? fail(result.message) : fail(RECURRING_PROBLEMS[result.reason]);
}

export const saveRecurringAction = adminAction(
  invoiceSchema.extend({
    id: z.string().regex(/^(?:[a-f0-9]{24})?$/),
    version: versionSchema,
    interval: z.enum(RECURRING_INTERVALS),
    nextOn: dateSchema,
    endOn: dateSchema,
  }),
  async (input, { db }) => {
    if (!input.nextOn) return fieldError("nextOn", "Choose the date of the next invoice.");
    if (input.endOn && input.endOn < input.nextOn) {
      return fieldError("endOn", "The last date can't come before the next one.");
    }
    const clientId = input.clientId ? new ObjectId(input.clientId) : null;
    if (clientId && !(await getClient(db, clientId)))
      return fieldError("clientId", "That client no longer exists.");
    const projectId = input.projectId ? new ObjectId(input.projectId) : null;
    if (projectId && !(await getProject(db, projectId)))
      return fieldError("projectId", "That project no longer exists.");
    const plan: RecurringInput = {
      ...documentFields(input),
      clientId,
      projectId,
      methods: input.methods,
      interval: input.interval,
      nextOn: input.nextOn,
      endOn: input.endOn,
    };
    let id: ObjectId;
    try {
      // Every invoice of the plan is issued without the owner looking: it has to be issuable now.
      const totals = computeTotals(plan.lines, plan.discount, plan.taxes);
      if (totals.totalMinor <= 0) return fieldError("lines", "Add at least one line with an amount.");
      const check = checkIssue(
        { kind: "invoice", currency: plan.currency, methods: plan.methods, totals },
        await getBillingSettings(db),
      );
      if (!check.ok) return fieldError("methods", check.message);
      if (!input.id) {
        id = (await createRecurring(db, plan))._id;
      } else {
        const saved = await updateRecurring(db, new ObjectId(input.id), input.version, plan);
        if (!saved.ok) {
          return saved.reason === "invalid" ? fieldError("nextOn", saved.message) : recurringProblem(saved);
        }
        refresh();
        return ok(null, "Saved. Invoices already issued stay as they were.");
      }
    } catch (error) {
      return tooLarge(error);
    }
    redirect(`/admin/billing/recurring/${id.toHexString()}`);
  },
);

export const setRecurringActiveAction = adminAction(
  z.object({ id: idSchema, version: versionSchema, active: z.boolean() }),
  async (input, { db }) => {
    const changed = await setRecurringActive(db, new ObjectId(input.id), input.version, input.active);
    if (!changed.ok) return recurringProblem(changed);
    refresh();
    return ok(
      null,
      input.active
        ? `Resumed: the next invoice is on ${longDate(changed.plan.nextOn!)}.`
        : "Paused: no invoices until you resume it.",
    );
  },
);

export const issueRecurringNowAction = adminAction(z.object({ id: idSchema }), async (input, { db }) => {
  const plan = await getRecurring(db, new ObjectId(input.id));
  if (!plan) return fail(RECURRING_PROBLEMS.missing);
  const outcome = await issueNext(db, plan, notifyContext(), now());
  if (!outcome.ok) return fail(outcome.message);
  if (outcome.emailed) sendQueuedSoon();
  refresh();
  return ok(
    null,
    outcome.emailed
      ? `${outcome.invoice.number} is issued and on its way to ${outcome.invoice.recipient.email}.`
      : `${outcome.invoice.number} is issued. Email isn't set up (or there's no address): copy its link for the client.`,
  );
});

export const deleteRecurringAction = adminAction(z.object({ id: idSchema }), async (input, { db }) => {
  if (!(await deleteRecurring(db, new ObjectId(input.id)))) return fail(RECURRING_PROBLEMS.missing);
  redirect("/admin/billing/recurring");
});

// The automatic reminders of an overdue invoice, stopped (a client promised to pay) or started again.
export const setInvoiceRemindersAction = adminAction(
  z.object({ id: idSchema, paused: z.boolean() }),
  async (input, { db }) => {
    if (!(await setRemindersPaused(db, new ObjectId(input.id), input.paused))) {
      return fail("Only an unpaid invoice sends reminders.");
    }
    refresh();
    return ok(null, input.paused ? "No more reminders for this invoice." : "Reminders are on again.");
  },
);

// --- Settings --------------------------------------------------------------------------------------------------

export const saveBillingProfileAction = adminAction(billingProfileSchema, async (input, { db }) => {
  try {
    await saveBillingProfile(
      db,
      {
        documentLabel: input.documentLabel,
        business: {
          name: input.business.name,
          address: input.business.address,
          email: input.business.email!,
          taxId: input.business.taxId,
          note: input.business.note,
        },
        paymentTermsDays: input.paymentTermsDays,
        quoteValidityDays: input.quoteValidityDays,
        methods: input.methods,
        baseCurrency: input.baseCurrency,
      },
      input.version,
    );
  } catch (error) {
    if (error instanceof StaleBillingError) return fail(error.message);
    throw error;
  }
  refresh();
  return ok(null, "Saved. New documents use these details; issued ones keep theirs.");
});

// Where clients send money: confirmed with sudo, written to the audit log, and announced to the owner's
// email, so a stolen session can't quietly swap the IBAN on the next invoice.
export const saveBankAccountsAction = adminAction(
  z.object({
    version: versionSchema,
    accounts: z.array(bankAccountSchema).max(5, "Keep at most 5 accounts."),
  }),
  async (input, { db, user, client }) => {
    if (new Set(input.accounts.map((account) => account.id)).size !== input.accounts.length) {
      return fail("Two accounts have the same id. Reload and try again.");
    }
    try {
      await saveBankAccounts(db, input.accounts, input.version);
    } catch (error) {
      if (error instanceof StaleBillingError) return fail(error.message);
      throw error;
    }
    const at = now();
    await audit(db, {
      action: "billing.bank.changed",
      actorId: user._id,
      ip: client.ip,
      userAgent: client.userAgent,
      details: { accounts: input.accounts.length },
    });
    const ownerEmail = readChannels().ownerEmail;
    if (ownerEmail) {
      await enqueue(db, {
        channel: "email",
        payload: {
          to: [{ address: ownerEmail }],
          subject: "Bank details changed on leffloard.xyz",
          text: [
            `The bank accounts printed on new invoices were changed on ${formatDateTime(at)} (${ADMIN_TIME_ZONE}), from ${client.ip}.`,
            "",
            "If this wasn't you: sign in, sign out every other device on the Security page, change your password and put the accounts back.",
            "",
          ].join("\n"),
        },
        dedupeKey: `billing:bank:${at.getTime()}`,
        label: "Bank details changed",
      });
      sendQueuedSoon();
    }
    refresh();
    return ok(null, "Bank accounts saved. New invoices print them; issued ones keep theirs.");
  },
  { sudo: true },
);

// --- Payments --------------------------------------------------------------------------------------------------

const amountText = z
  .string()
  .max(24)
  .transform((value, context) => {
    const parsed = parseAmount(value);
    if (!parsed.ok || !parsed.minor) {
      context.addIssue({
        code: "custom",
        message: parsed.ok ? "Enter the amount that arrived." : parsed.message,
      });
      return z.NEVER;
    }
    return parsed.minor;
  });

// Money recorded by hand changes the books: sudo, the audit log, and the client's receipt.
export const recordBankPaymentAction = adminAction(
  z.object({
    invoiceId: idSchema,
    amount: amountText,
    receivedOn: dateSchema,
    reference: text({ maxLength: 140 }),
  }),
  async (input, { db, user, client }) => {
    if (!input.receivedOn) return fieldError("receivedOn", "When did it arrive?");
    if (input.receivedOn > today()) return fieldError("receivedOn", "That day hasn't come yet.");
    const recorded = await recordBankPayment(db, new ObjectId(input.invoiceId), {
      amountMinor: input.amount,
      receivedOn: input.receivedOn,
      reference: input.reference ?? "",
    });
    if (!recorded.ok) return fail(recorded.message);
    await audit(db, {
      action: "billing.payment.recorded",
      actorId: user._id,
      ip: client.ip,
      userAgent: client.userAgent,
      details: { invoice: recorded.invoice.number, amountMinor: input.amount },
    });
    if (await emailReceipt(db, recorded.invoice, recorded.payment, notifyContext())) sendQueuedSoon();
    refresh();
    return ok(null, recorded.invoice.status === "paid" ? "Recorded. The invoice is paid." : "Recorded.");
  },
  { sudo: true },
);

export const refundPaymentAction = adminAction(
  z.object({
    paymentId: idSchema,
    note: text({
      maxLength: 500,
      required: true,
      requiredMessage: "Note how it was refunded, for the record.",
    }),
  }),
  async (input, { db, user, client }) => {
    const refunded = await refundPayment(db, new ObjectId(input.paymentId), input.note!);
    if (!refunded.ok) return fail(refunded.message);
    await audit(db, {
      action: "billing.payment.refunded",
      actorId: user._id,
      ip: client.ip,
      userAgent: client.userAgent,
      details: { invoice: refunded.invoice.number, amountMinor: refunded.payment.amountMinor },
    });
    refresh();
    return ok(null, "Marked as refunded. The invoice counts it no longer.");
  },
  { sudo: true },
);

export const resolveReviewAction = adminAction(
  z.object({ paymentId: idSchema, decision: z.enum(["confirm", "fail"]), amount: z.string().max(24) }),
  async (input, { db, user, client }) => {
    let decision: { confirm: true; amountMinor: number } | { confirm: false } = { confirm: false };
    if (input.decision === "confirm") {
      const parsed = parseAmount(input.amount);
      if (!parsed.ok || !parsed.minor) return fieldError("amount", "Enter the amount that arrived.");
      decision = { confirm: true, amountMinor: parsed.minor };
    }
    const resolved = await resolveReview(db, new ObjectId(input.paymentId), decision);
    if (!resolved.ok) return fail(resolved.message);
    if (resolved.payment.status === "confirmed") {
      await audit(db, {
        action: "billing.payment.recorded",
        actorId: user._id,
        ip: client.ip,
        userAgent: client.userAgent,
        details: { invoice: resolved.invoice.number, amountMinor: resolved.payment.amountMinor },
      });
      if (await emailReceipt(db, resolved.invoice, resolved.payment, notifyContext())) sendQueuedSoon();
    }
    refresh();
    return ok(null, resolved.payment.status === "confirmed" ? "Confirmed and counted." : "Marked as failed.");
  },
  { sudo: true },
);
