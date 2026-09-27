import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SCHEDULES } from "@/lib/billing/document";
import { invoices } from "@/server/billing/collections";
import {
  createInvoice,
  draftCreditNote,
  issueInvoice,
  listInvoices,
  updateInvoice,
  voidInvoice,
  type InvoiceInput,
} from "@/server/billing/invoices";
import { amountLeft, recordBankPayment, refundPayment } from "@/server/billing/payments";
import {
  acceptQuote,
  createQuote,
  declineQuote,
  reopenQuote,
  sendQuote,
  type QuoteInput,
} from "@/server/billing/quotes";
import {
  getBillingSettings,
  saveBankAccounts,
  StaleBillingError,
  type BillingSettings,
  DEFAULT_BILLING,
} from "@/server/billing/settings";
import { createClient } from "@/server/clients/store";
import { resetClock } from "@/server/clock";
import { runMigrations } from "@/server/db/migrate";
import { projects } from "@/server/work/collections";
import { clientInput } from "../helpers/work";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

setupTestEnv();
const { db } = setupTestDb();

beforeEach(async () => {
  await runMigrations(db());
});

afterEach(() => resetClock());

const NOW = new Date("2026-09-28T06:00:00Z");
const TODAY = "2026-09-28";
const BANK = {
  id: "bank-1",
  label: "Dollar account",
  holder: "Mert Kaan Koparan",
  bankName: "Example Bank",
  iban: "TR000000000000000000000000",
  swift: "EXAMTRIS",
  currency: "USD" as const,
};

const line = (description: string, quantityMilli: number, unitMinor: number) => ({
  id: randomUUID(),
  description,
  quantityMilli,
  unitMinor,
});

async function settingsWithBank(): Promise<BillingSettings> {
  await saveBankAccounts(db(), [BANK], 0, NOW);
  return getBillingSettings(db());
}

async function quoteInput(overrides: Partial<QuoteInput> = {}): Promise<QuoteInput> {
  const client = await createClient(db(), clientInput(), {}, NOW);
  return {
    title: "Shop rebuild",
    clientId: client._id,
    inquiryId: null,
    recipient: {
      name: "Ada Lovelace",
      company: "Analytical Engines Ltd",
      email: "ada@example.com",
      address: "London",
    },
    currency: "USD",
    lines: [line("Design and build", 1_000, 150_000), line("Extra page", 2_000, 9_000)],
    discount: null,
    taxes: [],
    notes: "Hosting is not included.",
    schedule: [...SCHEDULES.half.steps],
    timeline: "About 3 weeks",
    revisionsIncluded: 2,
    extraRevisionMinor: 6_000,
    ...overrides,
  };
}

function invoiceInput(overrides: Partial<InvoiceInput> = {}): InvoiceInput {
  return {
    title: "Care plan, October",
    clientId: null,
    projectId: null,
    recipient: { name: "Grace Hopper", company: null, email: "grace@example.com", address: "" },
    currency: "USD",
    lines: [line("Care plan", 1_000, 9_900)],
    discount: null,
    taxes: [],
    notes: "",
    methods: ["bank", "crypto"],
    ...overrides,
  };
}

describe("billing settings", () => {
  it("starts from the defaults and saves with a version", async () => {
    const defaults = await getBillingSettings(db());
    expect(defaults).toMatchObject({ version: 0, documentLabel: "Payment request", paymentTermsDays: 7 });
    await saveBankAccounts(db(), [BANK], 0, NOW);
    await expect(saveBankAccounts(db(), [], 0, NOW)).rejects.toThrow(StaleBillingError);
    expect((await getBillingSettings(db())).bankAccounts).toEqual([BANK]);
  });
});

describe("quotes", () => {
  it("numbers a quote when it is sent, and keeps the number when it is changed and sent again", async () => {
    const quote = await createQuote(db(), await quoteInput(), NOW);
    expect(quote).toMatchObject({ status: "draft", number: null });
    expect(quote.totals.totalMinor).toBe(168_000); // 1,500 + 2 × 90
    expect(quote.publicId).toMatch(/^[0-9A-Za-z]{22}$/);

    const sent = await sendQuote(
      db(),
      quote._id,
      1,
      { quoteValidityDays: 14, business: DEFAULT_BILLING.business },
      TODAY,
      NOW,
    );
    expect(sent.ok && sent.quote).toMatchObject({
      status: "sent",
      number: "Q-2026-0001",
      validUntil: "2026-10-12",
    });
    // A second tab still sees the draft: it is sent already.
    expect(
      await sendQuote(
        db(),
        quote._id,
        1,
        { quoteValidityDays: 14, business: DEFAULT_BILLING.business },
        TODAY,
        NOW,
      ),
    ).toEqual({
      ok: false,
      reason: "locked",
    });
    const reopened = await reopenQuote(db(), quote._id, 2, NOW);
    expect(reopened.ok && reopened.quote.status).toBe("draft");
    const again = await sendQuote(
      db(),
      quote._id,
      3,
      { quoteValidityDays: 14, business: DEFAULT_BILLING.business },
      TODAY,
      NOW,
    );
    expect(again.ok && again.quote.number).toBe("Q-2026-0001");

    const other = await createQuote(db(), await quoteInput({ title: "Bot" }), NOW);
    const second = await sendQuote(
      db(),
      other._id,
      1,
      { quoteValidityDays: 14, business: DEFAULT_BILLING.business },
      TODAY,
      NOW,
    );
    expect(second.ok && second.quote.number).toBe("Q-2026-0002");
  });

  it("is accepted once: a project with its price and rounds, and the deposit invoiced", async () => {
    const settings = await settingsWithBank();
    const quote = await createQuote(db(), await quoteInput(), NOW);
    const sent = await sendQuote(db(), quote._id, 1, settings, TODAY, NOW);
    if (!sent.ok) throw new Error("not sent");

    // The client read version 2; an answer for another version is refused.
    const stale = await acceptQuote(db(), quote.publicId, 1, { name: "Ada", ip: null }, settings, TODAY, NOW);
    expect(stale).toEqual({ ok: false, problem: "changed" });
    const tooLate = await acceptQuote(
      db(),
      quote.publicId,
      2,
      { name: "Ada", ip: null },
      settings,
      "2026-10-13",
      NOW,
    );
    expect(tooLate).toEqual({ ok: false, problem: "expired" });

    // Two clicks at once: one acceptance.
    const [first, second] = await Promise.all([
      acceptQuote(db(), quote.publicId, 2, { name: "Ada Lovelace", ip: "203.0.113.9" }, settings, TODAY, NOW),
      acceptQuote(db(), quote.publicId, 2, { name: "Ada Lovelace", ip: "203.0.113.9" }, settings, TODAY, NOW),
    ]);
    const results = [first, second];
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toEqual({ ok: false, problem: "answered" });
    const accepted = results.find((result) => result.ok)!;
    if (!accepted.ok) throw new Error("not accepted");

    expect(accepted.quote).toMatchObject({ status: "accepted", acceptedBy: { name: "Ada Lovelace" } });
    expect(accepted.project).toMatchObject({
      title: "Shop rebuild",
      stage: "planned",
      budget: { amountMinor: 168_000, currency: "USD" },
      revisionPolicy: { included: 2, extraPrice: { amountMinor: 6_000, currency: "USD" } },
    });
    expect(accepted.project.milestones.map((milestone) => milestone.title)).toEqual([
      "Invoice: On delivery (50%)",
    ]);
    expect(accepted.invoice).toMatchObject({
      status: "issued",
      number: "INV-2026-0001",
      label: "Payment request",
      issueDate: TODAY,
      dueDate: "2026-10-05",
      bankAccount: BANK,
      methods: ["bank", "crypto"],
      totals: { totalMinor: 84_000 },
    });
    expect(await projects(db()).countDocuments()).toBe(1);
    expect(await declineQuote(db(), quote.publicId, 3, null, TODAY, NOW)).toEqual({
      ok: false,
      problem: "answered",
    });
  });

  it("leaves no trace when acceptance fails half way", async () => {
    const settings = await getBillingSettings(db());
    const quote = await createQuote(db(), await quoteInput(), NOW);
    await sendQuote(db(), quote._id, 1, settings, TODAY, NOW);
    // The client was deleted meanwhile: the project can't be made, so nothing is.
    await db().collection("clients").deleteMany({});
    expect(
      await acceptQuote(db(), quote.publicId, 2, { name: "Ada", ip: null }, settings, TODAY, NOW),
    ).toEqual({ ok: false, problem: "missing" });
    expect((await db().collection("quotes").findOne({ _id: quote._id }))?.status).toBe("sent");
    expect(await db().collection("invoices").countDocuments()).toBe(0);
    expect(await db().collection<{ _id: string }>("counters").findOne({ _id: "invoice:2026" })).toBeNull();
  });
});

describe("invoices", () => {
  it("numbers invoices at issue without gaps, however many are issued at once", async () => {
    const settings = await settingsWithBank();
    const drafts = await Promise.all(
      Array.from({ length: 6 }, () => createInvoice(db(), invoiceInput(), {}, NOW)),
    );
    const issued = await Promise.all(
      drafts.map((draft) => issueInvoice(db(), draft._id, 1, settings, TODAY, NOW)),
    );
    const numbers = issued.map((result) => (result.ok ? result.invoice.number : null)).sort();
    expect(numbers).toEqual([
      "INV-2026-0001",
      "INV-2026-0002",
      "INV-2026-0003",
      "INV-2026-0004",
      "INV-2026-0005",
      "INV-2026-0006",
    ]);
  });

  it("is frozen once issued, and can be voided while nothing is paid or credited", async () => {
    const draft = await createInvoice(db(), invoiceInput(), {}, NOW);
    // Bank transfer needs an account on file.
    const refused = await issueInvoice(db(), draft._id, 1, await getBillingSettings(db()), TODAY, NOW);
    expect(refused).toMatchObject({ ok: false, reason: "invalid" });
    const settings = await settingsWithBank();
    const issued = await issueInvoice(db(), draft._id, 1, settings, TODAY, NOW);
    if (!issued.ok) throw new Error("not issued");
    expect(issued.invoice.seller?.name).toBe("Mert Kaan Koparan");

    expect(await updateInvoice(db(), draft._id, 2, invoiceInput({ title: "Changed" }), NOW)).toEqual({
      ok: false,
      reason: "locked",
    });
    const voided = await voidInvoice(db(), draft._id, 2, "Sent to the wrong client.", NOW);
    expect(voided.ok && voided.invoice).toMatchObject({
      status: "void",
      voidReason: "Sent to the wrong client.",
    });
  });

  it("takes credit notes off what's owed, never beyond the invoice's total", async () => {
    const settings = await settingsWithBank();
    const draft = await createInvoice(db(), invoiceInput({ lines: [line("Shop", 1_000, 100_000)] }), {}, NOW);
    const issued = await issueInvoice(db(), draft._id, 1, settings, TODAY, NOW);
    if (!issued.ok) throw new Error("not issued");
    const payment = await recordBankPayment(
      db(),
      draft._id,
      { amountMinor: 40_000, receivedOn: TODAY, reference: "" },
      NOW,
    );
    if (!payment.ok) throw new Error(payment.message);

    // The rest is taken off by a credit note: nothing is owed any more.
    const credit = (await draftCreditNote(db(), draft._id, NOW))!;
    expect(credit).toMatchObject({ kind: "credit", status: "draft", creditFor: draft._id });
    await updateInvoice(
      db(),
      credit._id,
      1,
      invoiceInput({ lines: [line("Unused pages", 1_000, 60_000)] }),
      NOW,
    );
    const creditIssued = await issueInvoice(db(), credit._id, 2, settings, TODAY, NOW);
    expect(creditIssued.ok && creditIssued.invoice).toMatchObject({ number: "CN-2026-0001", dueDate: null });
    const settled = (await invoices(db()).findOne({ _id: draft._id }))!;
    expect(settled).toMatchObject({ status: "paid", paidMinor: 40_000, creditedMinor: 60_000, paidAt: NOW });
    expect(amountLeft(settled)).toBe(0);

    // More than the invoice's total can't be credited, nor in another currency.
    const tooMuch = (await draftCreditNote(db(), draft._id, NOW))!;
    await updateInvoice(db(), tooMuch._id, 1, invoiceInput({ lines: [line("More", 1_000, 50_000)] }), NOW);
    expect(await issueInvoice(db(), tooMuch._id, 2, settings, TODAY, NOW)).toEqual({
      ok: false,
      reason: "invalid",
      message: "At most $400 is left to credit on INV-2026-0001.",
    });
    await updateInvoice(
      db(),
      tooMuch._id,
      2,
      invoiceInput({ currency: "EUR", lines: [line("More", 1_000, 1_000)] }),
      NOW,
    );
    expect(await issueInvoice(db(), tooMuch._id, 3, settings, TODAY, NOW)).toMatchObject({
      ok: false,
      message: "A credit note is in its invoice's currency (USD).",
    });

    // Neither the credited invoice nor its credit note can be voided.
    expect(await voidInvoice(db(), draft._id, settled.version, "No", NOW)).toMatchObject({
      ok: false,
      reason: "locked",
    });
    const note = (await invoices(db()).findOne({ _id: credit._id }))!;
    expect(await voidInvoice(db(), credit._id, note.version, "No", NOW)).toMatchObject({
      ok: false,
      message: "A credit note can't be voided: issue a new invoice to take it back.",
    });
    // The unpaid list holds invoices only.
    expect((await listInvoices(db(), { view: "open" })).map((invoice) => invoice.number)).toEqual([]);

    // The payment refunded: what it paid is owed again.
    await refundPayment(db(), payment.payment._id, "Returned", NOW);
    const reopened = (await invoices(db()).findOne({ _id: draft._id }))!;
    expect(reopened).toMatchObject({ status: "issued", paidMinor: 0, paidAt: null });
    expect(amountLeft(reopened)).toBe(40_000);
  });

  it("is refused by the database when malformed", async () => {
    await expect(
      db()
        .collection("invoices")
        .insertOne({
          publicId: "x",
          kind: "invoice",
          status: "issued",
          currency: "XXX",
          lines: [],
          totals: { subtotalMinor: 0, discountMinor: 0, taxes: [], totalMinor: 0 },
          paidMinor: 0,
          methods: [],
          version: 1,
          clientId: new ObjectId(),
        }),
    ).rejects.toMatchObject({ code: 121 });
  });
});
