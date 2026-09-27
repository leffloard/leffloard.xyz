import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoices, recurringInvoices } from "@/server/billing/collections";
import { createInvoice, issueInvoice, type InvoiceInput } from "@/server/billing/invoices";
import { recordBankPayment, refundPayment } from "@/server/billing/payments";
import {
  createRecurring,
  issueDueRecurring,
  issueNext,
  runRecurringJob,
  setRecurringActive,
  updateRecurring,
} from "@/server/billing/recurring";
import { nextOccurrence } from "@/lib/billing/recurring";
import { nextReminderOn, sendOverdueReminders, setRemindersPaused } from "@/server/billing/reminders";
import { getBillingSettings, saveBankAccounts } from "@/server/billing/settings";
import type { InvoiceDoc } from "@/server/billing/types";
import { createClient } from "@/server/clients/store";
import { resetClock, setClock } from "@/server/clock";
import { closeClient } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { fxRates } from "@/server/finance/collections";
import { createExpense } from "@/server/finance/expenses";
import { refreshRates, RatesUnavailableError } from "@/server/finance/rates";
import { financeCsv, financeReport } from "@/server/finance/report";
import { readChannels } from "@/server/notify/channels";
import type { OutboxDoc } from "@/server/notify/outbox";
import { clientInput } from "../helpers/work";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

const { db, url, name } = setupTestDb();
setupTestEnv({
  MONGO_URL: url,
  DB_NAME: name,
  EMAIL_DELIVERY: "log",
  NOTIFY_EMAIL_TO: "owner@leffloard.test",
});

// Monday 28 September 2026, 09:00 in Istanbul.
const NOW = new Date("2026-09-28T06:00:00Z");
const notify = () => ({ siteUrl: "https://leffloard.test", channels: readChannels() });

// TCMB: today.xml and the archive, with bulletins on the days the test sets.
const tcmb = {
  bulletins: new Map<string, { USD: string; EUR: string }>(),
  latest: "",
  down: false,
  asked: [] as string[],
};

function bulletinXml(day: string, rates: { USD: string; EUR: string }): string {
  const [year, month, date] = day.split("-");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Tarih_Date Tarih="${date}.${month}.${year}" Date="${month}/${date}/${year}" Bulten_No="${year}/1">
  <Currency CrossOrder="0" Kod="USD" CurrencyCode="USD"><Unit>1</Unit><ForexBuying>${rates.USD}</ForexBuying></Currency>
  <Currency CrossOrder="9" Kod="EUR" CurrencyCode="EUR"><Unit>1</Unit><ForexBuying>${rates.EUR}</ForexBuying></Currency>
</Tarih_Date>`;
}

beforeEach(async () => {
  await runMigrations(db());
  setClock(() => NOW);
  tcmb.bulletins.clear();
  tcmb.latest = "";
  tcmb.down = false;
  tcmb.asked = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const address = String(input);
    tcmb.asked.push(address.replace("https://www.tcmb.gov.tr/kurlar/", ""));
    if (tcmb.down) throw new TypeError("fetch failed");
    if (address.endsWith("/today.xml")) {
      const rates = tcmb.bulletins.get(tcmb.latest);
      return rates ? new Response(bulletinXml(tcmb.latest, rates)) : new Response("gone", { status: 404 });
    }
    const match = /\/kurlar\/(\d{4})(\d{2})\/(\d{2})\d{2}\d{4}\.xml$/.exec(address);
    const day = match ? `${match[1]}-${match[2]}-${match[3]}` : "";
    const rates = tcmb.bulletins.get(day);
    return rates ? new Response(bulletinXml(day, rates)) : new Response("<html>404</html>", { status: 404 });
  });
});

afterEach(() => {
  resetClock();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await closeClient();
});

async function bankAccount() {
  await saveBankAccounts(
    db(),
    [
      {
        id: "bank-1",
        label: "Any currency",
        holder: "Mert Kaan Koparan",
        bankName: "Example Bank",
        iban: "TR330006100519786457841326",
        swift: null,
        currency: null,
      },
    ],
    (await getBillingSettings(db())).version,
    NOW,
  );
}

function content(overrides: Partial<InvoiceInput> = {}): InvoiceInput {
  return {
    title: "Shop rebuild",
    clientId: null,
    projectId: null,
    recipient: { name: "Ada Lovelace", company: null, email: "ada@example.com", address: "" },
    currency: "USD",
    lines: [{ id: randomUUID(), description: "Work", quantityMilli: 1000, unitMinor: 100_000 }],
    discount: null,
    taxes: [],
    notes: "",
    methods: ["bank"],
    ...overrides,
  };
}

async function issued(overrides: Partial<InvoiceInput> = {}, today = "2026-09-01"): Promise<InvoiceDoc> {
  const draft = await createInvoice(db(), content(overrides), {}, NOW);
  const result = await issueInvoice(db(), draft._id, 1, await getBillingSettings(db()), today, NOW);
  if (!result.ok) throw new Error(`not issued: ${result.reason}`);
  return result.invoice;
}

async function paid(invoice: InvoiceDoc, amountMinor: number, receivedOn: string) {
  const result = await recordBankPayment(
    db(),
    invoice._id,
    { amountMinor, receivedOn, reference: "EFT" },
    NOW,
  );
  if (!result.ok) throw new Error(result.message);
  return result.payment;
}

const outbox = () => db().collection<OutboxDoc>("outbox").find().sort({ _id: 1 }).toArray();

describe("exchange rates", () => {
  it("store the latest bulletin, and find older ones in TCMB's archive for the days that need them", async () => {
    await bankAccount();
    const invoice = await issued();
    await paid(invoice, 30_000, "2026-09-15"); // a Tuesday: needs Monday the 14th
    await createExpense(
      db(),
      {
        date: "2026-09-21", // a Monday: needs Friday the 18th
        amountMinor: 20_000,
        currency: "EUR",
        category: "hosting",
        vendor: "Hetzner",
        description: "Server",
        reference: "",
        projectId: null,
      },
      NOW,
    );
    tcmb.bulletins.set("2026-09-25", { USD: "41.5012", EUR: "48.7001" });
    tcmb.bulletins.set("2026-09-18", { USD: "41.2000", EUR: "48.4000" });
    tcmb.bulletins.set("2026-09-14", { USD: "41.0000", EUR: "48.1000" });
    tcmb.latest = "2026-09-25";

    expect(await refreshRates(db(), NOW)).toEqual({ latest: "2026-09-25", filled: 2, missing: 0 });
    expect(tcmb.asked).toEqual(["today.xml", "202609/18092026.xml", "202609/14092026.xml"]);
    expect(await fxRates(db()).findOne({ _id: "2026-09-14" })).toMatchObject({
      rates: { USD: 410_000, EUR: 481_000 },
    });

    // Nothing more to find: only today's file is asked again.
    tcmb.asked = [];
    expect(await refreshRates(db(), NOW)).toEqual({ latest: "2026-09-25", filled: 0, missing: 0 });
    expect(tcmb.asked).toEqual(["today.xml"]);
  });

  it("remember days without a bulletin, and fail loudly when TCMB is down", async () => {
    await createExpense(
      db(),
      {
        date: "2026-09-10",
        amountMinor: 5_000,
        currency: "USD",
        category: "software",
        vendor: "GitHub",
        description: "",
        reference: "",
        projectId: null,
      },
      NOW,
    );
    tcmb.bulletins.set("2026-09-25", { USD: "41.5012", EUR: "48.7001" });
    tcmb.bulletins.set("2026-09-07", { USD: "40.9000", EUR: "48.0000" });
    tcmb.latest = "2026-09-25";
    // The 9th and the 8th had no bulletin (a holiday, say); the 5th and 6th are a weekend.
    expect(await refreshRates(db(), NOW)).toMatchObject({ filled: 1, missing: 0 });
    expect(tcmb.asked).toEqual([
      "today.xml",
      "202609/09092026.xml",
      "202609/08092026.xml",
      "202609/07092026.xml",
    ]);
    expect(await fxRates(db()).findOne({ _id: "2026-09-09" })).toMatchObject({ rates: null });

    tcmb.down = true;
    await expect(refreshRates(db(), NOW)).rejects.toBeInstanceOf(RatesUnavailableError);
  });
});

describe("exchange rates, continued", () => {
  it("fetch a missing business day's bulletin instead of using an older one", async () => {
    await fxRates(db()).insertOne({
      _id: "2026-09-09",
      source: "TCMB",
      rates: { USD: 409_000, EUR: 480_000 },
      fetchedAt: NOW,
    });
    await createExpense(
      db(),
      {
        date: "2026-09-15",
        amountMinor: 5_000,
        currency: "EUR",
        category: "hosting",
        vendor: "Hetzner",
        description: "",
        reference: "",
        projectId: null,
      },
      NOW,
    );
    tcmb.bulletins.set("2026-09-25", { USD: "41.5012", EUR: "48.7001" });
    tcmb.bulletins.set("2026-09-14", { USD: "41.0000", EUR: "48.1000" });
    tcmb.latest = "2026-09-25";
    expect(await refreshRates(db(), NOW)).toMatchObject({ filled: 1, missing: 0 });
    expect(tcmb.asked).toEqual(["today.xml", "202609/14092026.xml"]);
    const report = await financeReport(db(), {
      from: "2026-09-01",
      to: "2026-09-30",
      today: "2026-09-28",
      base: "TRY",
    });
    expect(report.expenseMinor).toBe(240_500); // 50 € at 48.10, the 14th's, not the 9th's 48.00
  });
});

describe("the finance report", () => {
  async function scenario() {
    await bankAccount();
    await fxRates(db()).insertMany([
      { _id: "2026-08-31", source: "TCMB", rates: { USD: 400_000, EUR: 470_000 }, fetchedAt: NOW },
      { _id: "2026-09-14", source: "TCMB", rates: { USD: 410_000, EUR: 480_000 }, fetchedAt: NOW },
      { _id: "2026-09-25", source: "TCMB", rates: { USD: 415_000, EUR: 487_000 }, fetchedAt: NOW },
    ]);
    const client = await createClient(
      db(),
      clientInput({ name: "Grace Hopper", company: "Navy Labs" }),
      {},
      NOW,
    );
    const shop = await issued({
      clientId: client._id,
      recipient: { name: "Grace Hopper", company: "Navy Labs", email: "grace@example.com", address: "" },
    });
    const site = await issued({
      title: "Landing page",
      lines: [{ id: randomUUID(), description: "Page", quantityMilli: 1000, unitMinor: 50_000 }],
    });
    await paid(shop, 60_000, "2026-09-01"); // 600 USD at 40.00 = 24,000 TRY
    const refunded = await paid(site, 20_000, "2026-09-15"); // 200 USD at 41.00 = 8,200 TRY
    await paid(site, 10_000, "2026-08-10"); // August: no bulletin within ten days before it
    setClock(() => new Date("2026-09-26T09:00:00Z"));
    await refundPayment(db(), refunded._id, "Sent back", new Date("2026-09-26T09:00:00Z")); // at 41.50: -8,300 TRY
    setClock(() => NOW);
    await createExpense(
      db(),
      {
        date: "2026-09-26",
        amountMinor: 10_000,
        currency: "EUR",
        category: "hosting",
        vendor: "Hetzner",
        description: "Server",
        reference: "R-1",
        projectId: null,
      },
      NOW,
    ); // 100 EUR at 48.70 = 4,870 TRY
    await createExpense(
      db(),
      {
        date: "2026-09-02",
        amountMinor: 150_000,
        currency: "TRY",
        category: "software",
        vendor: "=cmd|' /C calc'!A0",
        description: "Editor",
        reference: "",
        projectId: null,
      },
      NOW,
    );
    // Still owed: 400 USD of the shop (due 8 Sep: 20 days late), 400 of the site.
    return { shop, site };
  }

  it("adds up income, expenses and profit in the base currency, month by month", async () => {
    await scenario();
    const report = await financeReport(db(), {
      from: "2026-08-01",
      to: "2026-09-30",
      today: "2026-09-28",
      base: "TRY",
    });
    expect(report.months).toEqual([
      { key: "2026-08", label: "Aug 2026", incomeMinor: 0, expenseMinor: 0, profitMinor: 0 },
      {
        key: "2026-09",
        label: "Sep 2026",
        incomeMinor: 2_400_000 + 820_000 - 830_000,
        expenseMinor: 487_000 + 150_000,
        profitMinor: 2_390_000 - 637_000,
      },
    ]);
    expect(report.incomeByCurrency).toEqual([{ amountMinor: 70_000, currency: "USD" }]);
    expect(report.expenseByCategory.map((row) => [row.category, row.baseMinor])).toEqual([
      ["hosting", 487_000],
      ["software", 150_000],
    ]);
    expect(report.byClient).toEqual([
      expect.objectContaining({ name: "Navy Labs", baseMinor: 2_400_000 }),
      expect.objectContaining({ name: "Ada Lovelace", baseMinor: -10_000 }),
    ]);
    // The August payment had no rate: counted in dollars, left out of the lira, and listed.
    expect(report.missing).toEqual([{ date: "2026-08-10", currency: "USD" }]);
    expect(report.aging.map((row) => [row.bucket, row.count, row.baseMinor])).toEqual([
      ["current", 0, 0],
      ["1-30", 2, (40_000 + 40_000) * 41.5],
      ["31-60", 0, 0],
      ["61-90", 0, 0],
      ["90+", 0, 0],
    ]);
    expect(report.owedMinor).toBe(3_320_000);
  });

  it("gives the accountant every movement, signed, with TCMB's rate", async () => {
    await scenario();
    const { csv, rows, missing } = await financeCsv(db(), {
      from: "2026-09-01",
      to: "2026-09-30",
      base: "TRY",
      format: "standard",
    });
    expect({ rows, missing }).toEqual({ rows: 5, missing: 0 });
    const lines = csv.replace("\ufeff", "").trim().split("\r\n");
    expect(lines[0]).toBe(
      "Date,Type,Document,Party,Description,Category,Method,Reference,Currency,Amount,TCMB bulletin,TCMB rate (TRY),Amount (TRY)",
    );
    expect(lines.slice(1)).toEqual([
      "2026-09-01,Payment received,INV-2026-0001,Navy Labs,Shop rebuild,,Bank transfer,EFT,USD,600.00,2026-08-31,40.0000,24000.00",
      "2026-09-02,Expense,,'=cmd|' /C calc'!A0,Editor,Software and subscriptions,,,TRY,-1500.00,,,-1500.00",
      "2026-09-15,Payment received,INV-2026-0002,Ada Lovelace,Landing page,,Bank transfer,EFT,USD,200.00,2026-09-14,41.0000,8200.00",
      "2026-09-26,Expense,R-1,Hetzner,Server,Hosting and domains,,,EUR,-100.00,2026-09-25,48.7000,-4870.00",
      "2026-09-26,Refund,INV-2026-0002,Ada Lovelace,Landing page,,Bank transfer,EFT,USD,-200.00,2026-09-25,41.5000,-8300.00",
    ]);
  });
});

describe("recurring invoices", () => {
  async function plan(overrides: Partial<Parameters<typeof createRecurring>[1]> = {}) {
    return createRecurring(
      db(),
      {
        ...content({
          title: "Care plan: {period}",
          lines: [
            {
              id: randomUUID(),
              description: "Updates and backups, {period}",
              quantityMilli: 1000,
              unitMinor: 4_900,
            },
          ],
        }),
        interval: "month",
        nextOn: "2026-08-28",
        endOn: null,
        ...overrides,
      },
      NOW,
    );
  }

  it("issue each date's invoice once, email it, and move to the next date", async () => {
    await bankAccount();
    const care = await plan();
    expect(await issueDueRecurring(db(), notify(), NOW)).toEqual({ issued: 1, failed: 0 });
    expect(await issueDueRecurring(db(), notify(), NOW)).toEqual({ issued: 1, failed: 0 }); // September's
    expect(await issueDueRecurring(db(), notify(), NOW)).toEqual({ issued: 0, failed: 0 });
    const issuedInvoices = await invoices(db()).find({ recurringId: care._id }).sort({ number: 1 }).toArray();
    expect(
      issuedInvoices.map((invoice) => [
        invoice.number,
        invoice.title,
        invoice.period,
        invoice.lines[0]!.description,
      ]),
    ).toEqual([
      ["INV-2026-0001", "Care plan: August 2026", "2026-08-28", "Updates and backups, August 2026"],
      ["INV-2026-0002", "Care plan: September 2026", "2026-09-28", "Updates and backups, September 2026"],
    ]);
    expect(issuedInvoices[0]).toMatchObject({
      status: "issued",
      issueDate: "2026-09-28",
      dueDate: "2026-10-05",
    });
    expect(await recurringInvoices(db()).findOne({ _id: care._id })).toMatchObject({
      nextOn: "2026-10-28",
      issuedCount: 2,
      lastIssuedOn: "2026-09-28",
      lastInvoiceId: issuedInvoices[1]!._id,
    });
    expect((await outbox()).map((item) => item.label)).toEqual([
      "Payment request INV-2026-0001 to Ada Lovelace",
      "Payment request INV-2026-0002 to Ada Lovelace",
    ]);
  });

  it("issue once when two runs race, and end after the last date", async () => {
    await bankAccount();
    const care = await plan({ nextOn: "2026-09-28", endOn: "2026-10-15" });
    const results = await Promise.all([
      issueNext(db(), care, notify(), NOW),
      issueNext(db(), care, notify(), NOW),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await invoices(db()).countDocuments({ recurringId: care._id })).toBe(1);
    expect(await recurringInvoices(db()).findOne({ _id: care._id })).toMatchObject({
      active: false,
      nextOn: null,
    });
  });

  it("tell the owner when an invoice can't be issued, and try again later", async () => {
    const care = await plan({ nextOn: "2026-09-28" }); // bank transfer, but no bank account yet
    expect(await issueDueRecurring(db(), notify(), NOW)).toEqual({ issued: 0, failed: 1 });
    expect(await recurringInvoices(db()).findOne({ _id: care._id })).toMatchObject({
      nextOn: "2026-09-28",
      lastError: "Add a bank account for USD in the billing settings, or untick bank transfer.",
    });
    expect((await outbox()).map((item) => item.label)).toEqual([
      "Recurring invoice not issued: Care plan: {period}",
    ]);
    await issueDueRecurring(db(), notify(), NOW);
    expect(await outbox()).toHaveLength(1); // told once

    await bankAccount();
    expect(await issueDueRecurring(db(), notify(), NOW)).toEqual({ issued: 1, failed: 0 });
    expect(await recurringInvoices(db()).findOne({ _id: care._id })).toMatchObject({ lastError: null });
  });

  it("stay paused through an edit, and skip the paused months when resumed", async () => {
    await bankAccount();
    const care = await plan({ nextOn: "2026-06-30" });
    const paused = await setRecurringActive(db(), care._id, 1, false, NOW);
    expect(paused).toMatchObject({ ok: true, plan: { active: false } });
    // A typo fixed while paused: the plan stays paused, on the 30th.
    const edited = await updateRecurring(
      db(),
      care._id,
      2,
      {
        ...content({ title: "Care plan: {period} (fixed)" }),
        interval: "month",
        nextOn: "2026-06-30",
        endOn: null,
      },
      NOW,
    );
    expect(edited).toMatchObject({ ok: true, plan: { active: false, anchorDay: 30 } });
    expect(await issueDueRecurring(db(), notify(), NOW)).toEqual({ issued: 0, failed: 0 });
    // Resumed on the 28th of September: June to August are not billed.
    const resumed = await setRecurringActive(db(), care._id, 3, true, NOW);
    expect(resumed).toMatchObject({ ok: true, plan: { active: true, nextOn: "2026-09-30" } });
  });

  it("keep their day of the month through an edit in a short month", async () => {
    await bankAccount();
    const care = await plan({ nextOn: "2026-01-31" });
    await recurringInvoices(db()).updateOne({ _id: care._id }, { $set: { nextOn: "2026-02-28" } });
    const edited = await updateRecurring(
      db(),
      care._id,
      1,
      { ...content({ title: "Care plan: {period}" }), interval: "month", nextOn: "2026-02-28", endOn: null },
      NOW,
    );
    expect(edited).toMatchObject({ ok: true, plan: { anchorDay: 31 } });
    expect(nextOccurrence("2026-02-28", "month", 31)).toBe("2026-03-31");
  });

  it("never bill a date twice, and let one plan's trouble hold up no other", async () => {
    await bankAccount();
    const first = await plan({ nextOn: "2026-09-28" });
    const second = await plan({ nextOn: "2026-09-28", title: "Hosting: {period}" });
    expect(await issueDueRecurring(db(), notify(), NOW)).toEqual({ issued: 2, failed: 0 });
    // Set back to the date just billed: refused when saved...
    const current = (await recurringInvoices(db()).findOne({ _id: first._id }))!;
    expect(
      await updateRecurring(
        db(),
        first._id,
        current.version,
        {
          ...content({ title: "Care plan: {period}" }),
          interval: "month",
          nextOn: "2026-09-28",
          endOn: null,
        },
        NOW,
      ),
    ).toMatchObject({
      ok: false,
      reason: "invalid",
      message: expect.stringContaining("INV-2026-0001 already covers"),
    });
    // ...and, if it gets there anyway, the run reports it and goes on with the other plans.
    await recurringInvoices(db()).updateOne({ _id: first._id }, { $set: { nextOn: "2026-09-28" } });
    await recurringInvoices(db()).updateOne({ _id: second._id }, { $set: { nextOn: "2026-09-28" } });
    await invoices(db()).deleteOne({ recurringId: second._id });
    expect(await issueDueRecurring(db(), notify(), NOW)).toEqual({ issued: 1, failed: 1 });
    expect((await recurringInvoices(db()).findOne({ _id: first._id }))?.lastError).toContain(
      "INV-2026-0001 already covers September 2026",
    );
  });

  it("run during the day only", async () => {
    await bankAccount();
    await plan({ nextOn: "2026-09-28" });
    expect(await runRecurringJob(db(), notify(), new Date("2026-09-28T03:00:00Z"))).toBeNull(); // 06:00
    expect(await runRecurringJob(db(), notify(), NOW)).toMatchObject({
      ran: true,
      ok: true,
      message: "1 issued",
    });
  });
});

describe("overdue reminders", () => {
  it("go out a day, a week and two weeks after the due date, one at a time", async () => {
    await bankAccount();
    const invoice = await issued({}, "2026-09-01"); // due 8 September
    const at = (day: string) => new Date(`${day}T08:00:00Z`);
    expect(await sendOverdueReminders(db(), notify(), at("2026-09-08"))).toBe(0);
    expect(await sendOverdueReminders(db(), notify(), at("2026-09-09"))).toBe(1);
    expect(await sendOverdueReminders(db(), notify(), at("2026-09-09"))).toBe(0);
    expect(nextReminderOn((await invoices(db()).findOne({ _id: invoice._id }))!)).toBe("2026-09-15");
    expect(await sendOverdueReminders(db(), notify(), at("2026-09-15"))).toBe(1);
    expect(await sendOverdueReminders(db(), notify(), at("2026-09-22"))).toBe(1);
    expect(await sendOverdueReminders(db(), notify(), at("2026-10-30"))).toBe(0);
    const reminders = (await outbox()).filter((item) => item.label.startsWith("Reminder"));
    expect(reminders.map((item) => item.label)).toEqual([
      "Reminder 1 for INV-2026-0001 to Ada Lovelace",
      "Reminder 2 for INV-2026-0001 to Ada Lovelace",
      "Reminder 3 for INV-2026-0001 to Ada Lovelace",
    ]);
    const last = reminders[2]!.payload as { subject: string; text: string };
    expect(last.subject).toBe("Reminder: payment request INV-2026-0001 is overdue");
    expect(last.text).toContain("This is the last automatic reminder.");
    expect(last.text).toContain("Amount due: $1,000\n");
  });

  it("wait when the invoice is long overdue already, and stop when paused or paid", async () => {
    await bankAccount();
    const late = await issued({}, "2026-07-01");
    const paused = await issued({}, "2026-09-01");
    const settled = await issued({}, "2026-09-01");
    await setRemindersPaused(db(), paused._id, true);
    await paid(settled, 100_000, "2026-09-05");
    expect(await sendOverdueReminders(db(), notify(), NOW)).toBe(1);
    expect(await sendOverdueReminders(db(), notify(), new Date(NOW.getTime() + 86_400_000))).toBe(0);
    expect(await sendOverdueReminders(db(), notify(), new Date(NOW.getTime() + 5 * 86_400_000))).toBe(1);
    expect((await invoices(db()).findOne({ _id: late._id }))?.remindersSent).toBe(2);
    expect((await invoices(db()).findOne({ _id: paused._id }))?.remindersSent).toBe(0);
  });
});
