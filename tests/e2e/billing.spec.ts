import type { Db } from "mongodb";
import { E2E_MOCK_URL } from "./fixtures";
import { axeViolations, signInOwner, withDb } from "./helpers";
import { expect, test, watchPage } from "./test";

// Billing from the owner's side and the client's: a bank account, a quote written from a client, sent,
// opened and accepted from its link, the project and the first invoice that follow, and the PDFs; paying in
// crypto (NOWPayments played by a local mock, see scripts/lib/e2e-mocks.ts), a bank transfer and its refund,
// a care plan, expenses and the finance pages. Runs after the calendar tests (see playwright.config.ts), one
// step after another.

test.describe.configure({ mode: "serial" });

const CLIENT_EMAIL = "grace.billing@example.com";
let quoteLink = "";

async function resetBilling(db: Db): Promise<void> {
  for (const name of [
    "quotes",
    "invoices",
    "payments",
    "payment_events",
    "recurring_invoices",
    "expenses",
    "fx_rates",
  ]) {
    await db.collection(name).deleteMany({});
  }
  await db
    .collection<{ _id: string }>("counters")
    .deleteMany({ _id: { $regex: "^(quote|invoice|credit):" } });
  await db.collection<{ _id: string }>("settings").deleteOne({ _id: "billing" });
  await db.collection("clients").deleteMany({ email: CLIENT_EMAIL });
  await db
    .collection("outbox")
    .deleteMany({ dedupeKey: { $regex: "^(quote|invoice|billing|payment|recurring):" } });
  await db
    .collection<{ _id: string }>("rate_limits")
    .deleteMany({ _id: { $regex: "^(quote|checkout|ipn):" } });
}

test.beforeAll(async () => {
  await withDb(resetBilling);
});

test("the owner adds a bank account, then writes and sends a quote", async ({ page }) => {
  await signInOwner(page.context());
  await page.goto("/admin/billing/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Billing settings" })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("button", { name: "Add an account" }).click();
  await page.getByLabel("Name (for you)").fill("Lira account");
  await page.getByLabel("Account holder").fill("Mert Kaan Koparan");
  await page.getByLabel("Bank", { exact: true }).fill("Example Bank");
  await page.getByLabel("IBAN").fill("TR33 0006 1005 1978 6457 8413 27");
  await page.getByLabel("Takes").selectOption("any");
  await page.getByRole("button", { name: "Save bank accounts" }).click();
  await expect(page.getByText("This IBAN doesn't check out: look for a typo.")).toBeVisible();
  await page.getByLabel("IBAN").fill("TR33 0006 1005 1978 6457 8413 26");
  await page.getByRole("button", { name: "Save bank accounts" }).click();
  await expect(
    page.getByText("Bank accounts saved. New invoices print them; issued ones keep theirs."),
  ).toBeVisible();
  // Written to the activity log, and announced by email.
  await expect
    .poll(() => withDb((db) => db.collection("audit_log").countDocuments({ action: "billing.bank.changed" })))
    .toBeGreaterThan(0);
  expect(
    await withDb((db) => db.collection("outbox").countDocuments({ label: "Bank details changed" })),
  ).toBe(1);

  // A client, then a quote for them.
  await page.goto("/admin/clients/new");
  await page.getByLabel("Name", { exact: true }).fill("Grace Hopper");
  await page.getByLabel("Email", { exact: true }).fill(CLIENT_EMAIL);
  await page.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Grace Hopper" })).toBeVisible();
  await page.getByRole("link", { name: "New quote" }).click();
  await expect(page).toHaveURL(/\/admin\/billing\/quotes\/new\?client=/);
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(CLIENT_EMAIL);
  expect(await axeViolations(page)).toEqual([]);

  await page.getByLabel("Title").fill("Shop rebuild");
  await page.getByLabel("Line 1, description").fill("Design and build of the new shop");
  await page.getByLabel("Line 1, unit price").fill("1,500");
  await page
    .getByLabel("Add from the services")
    .selectOption({ label: "Websites & web apps: Launch (from $350)" });
  await expect(page.getByLabel("Line 2, unit price")).toHaveValue("350");
  await expect(
    page.getByText("Deposit: $925 · On delivery: $925. The first is invoiced when the client accepts."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create the quote" }).click();
  await expect(page).toHaveURL(/\/admin\/billing\/quotes\/[a-f0-9]{24}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Draft quote: Shop rebuild" })).toBeVisible();

  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(`Q-2026-0001 is on its way to ${CLIENT_EMAIL}.`)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Q-2026-0001: Shop rebuild" })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  quoteLink = (await page.getByRole("link", { name: "Open it as the client" }).getAttribute("href"))!;
  expect(quoteLink).toMatch(/\/q\/[0-9A-Za-z]{22}$/);
  expect(
    await withDb((db) =>
      db.collection("outbox").countDocuments({ label: "Quote Q-2026-0001 to Grace Hopper" }),
    ),
  ).toBe(1);

  const pdf = await page.request.get(page.url() + "/pdf");
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
});

test("the client accepts the quote from its link and sees the first payment", async ({ browser }) => {
  const context = await browser.newContext();
  const client = await context.newPage();
  const errors: string[] = [];
  watchPage(client, errors);
  await client.emulateMedia({ reducedMotion: "reduce" });

  await client.goto(quoteLink);
  await expect(client.getByRole("heading", { level: 1, name: "Shop rebuild" })).toBeVisible();
  // The document itself writes amounts with currency codes, like the PDF.
  await expect(client.getByText("USD 1,850.00").first()).toBeVisible();
  expect(await axeViolations(client)).toEqual([]);
  await client.getByLabel("I accept this quote").check();
  await client.getByRole("button", { name: "Accept the quote" }).click();
  await expect(client.getByText("Accepted. Thank you!")).toBeVisible();
  await client.getByRole("link", { name: "See the first payment" }).click();

  await expect(client).toHaveURL(/\/i\/[0-9A-Za-z]{22}$/);
  await expect(client.getByRole("heading", { level: 1, name: "Deposit: Shop rebuild" })).toBeVisible();
  await expect(client.getByText("$925", { exact: true })).toBeVisible();
  await expect(client.getByText("TR33 0006 1005 1978 6457 8413 26")).toBeVisible();
  expect(await axeViolations(client)).toEqual([]);
  const pdf = await client.request.get(client.url() + "/pdf");
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect(errors).toEqual([]);
  await context.close();

  const quote = await withDb((db) => db.collection("quotes").findOne({ number: "Q-2026-0001" }));
  expect(quote?.status).toBe("accepted");
  expect(quote?.viewedAt).toBeInstanceOf(Date);
  expect(quote?.acceptedBy?.name).toBe("Grace Hopper");
});

test("the owner sees the answer, the project and the invoice", async ({ page }) => {
  await signInOwner(page.context());
  await page.goto("/admin/billing");
  await expect(page.getByRole("link", { name: /INV-2026-0001/ })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await page.goto("/admin/billing/quotes?view=answered");
  await page.getByRole("link", { name: /Q-2026-0001/ }).click();
  await expect(page.getByText("Accepted", { exact: true })).toBeVisible();
  await expect(page.getByText("Opened by the client")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("link", { name: "Open the project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Shop rebuild" })).toBeVisible();
  await expect(page.getByText("Invoice: On delivery (50%)")).toBeVisible();

  await page.goto("/admin/billing/invoices");
  await page.getByRole("link", { name: /INV-2026-0001/ }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "INV-2026-0001: Deposit: Shop rebuild" }),
  ).toBeVisible();
  await expect(page.getByText("Awaiting payment")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  const labels = await withDb((db) =>
    db
      .collection("outbox")
      .find({ dedupeKey: { $regex: "^(quote|invoice):" } })
      .sort({ createdAt: 1, _id: 1 })
      .map((item) => item.label as string)
      .toArray(),
  );
  expect(labels).toEqual([
    "Quote Q-2026-0001 to Grace Hopper",
    "Quote accepted: Q-2026-0001",
    "Payment request INV-2026-0001 to Grace Hopper",
  ]);
});

test("the client pays the deposit in cryptocurrency and gets a receipt", async ({ browser, request }) => {
  const invoice = await withDb((db) => db.collection("invoices").findOne({ number: "INV-2026-0001" }));
  const context = await browser.newContext();
  const client = await context.newPage();
  const errors: string[] = [];
  watchPage(client, errors);
  await client.emulateMedia({ reducedMotion: "reduce" });

  await client.goto(`/i/${invoice!.publicId as string}`);
  await client.getByRole("button", { name: "Pay in cryptocurrency" }).click();
  await expect(client.getByRole("heading", { name: "NOWPayments (test)" })).toBeVisible();
  // NOWPayments confirms the payment with a signed callback, which the app checks against its API.
  const checkout = new URL(client.url()).pathname.split("/").pop();
  const paid = await request.post(`${E2E_MOCK_URL}/control/pay`, { data: { invoiceId: checkout } });
  expect(await paid.json()).toMatchObject({ ipn: { status: 200, body: { ok: true, outcome: "confirmed" } } });

  await client.getByRole("link", { name: "Back to the shop" }).click();
  await expect(client.getByRole("heading", { level: 1, name: "Paid. Thank you!" })).toBeVisible();
  expect(await axeViolations(client)).toEqual([]);
  await client.getByRole("link", { name: "Back to the invoice" }).click();
  await expect(client.getByText("Paid. Thank you!")).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();

  const labels = await withDb((db) =>
    db
      .collection("outbox")
      .find({ dedupeKey: { $regex: "^payment:" } })
      .map((item) => item.label as string)
      .toArray(),
  );
  expect(labels.sort()).toEqual([
    "Payment received: INV-2026-0001",
    "Receipt for INV-2026-0001 to Grace Hopper",
  ]);
});

test("the owner records a bank transfer, then refunds it", async ({ page }) => {
  await signInOwner(page.context());
  const client = await withDb((db) => db.collection("clients").findOne({ email: CLIENT_EMAIL }));
  await page.goto(`/admin/billing/invoices/new?client=${client!._id.toHexString()}`);
  await page.getByLabel("Title").fill("Extra pages");
  await page.getByLabel("Line 1, description").fill("Two more pages");
  await page.getByLabel("Line 1, unit price").fill("500");
  await page.getByRole("button", { name: "Create the invoice" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Draft invoice: Extra pages" })).toBeVisible();
  await page.getByRole("button", { name: "Issue", exact: true }).click();
  await expect(page.getByText(`INV-2026-0002 is issued and on its way to ${CLIENT_EMAIL}.`)).toBeVisible();
  await expect(page.getByText("0 of 3 sent")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("button", { name: "Record a bank transfer" }).click();
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("500");
  await page.getByLabel("Reference (optional)").fill("EFT 4411");
  await page.getByRole("button", { name: "Record it" }).click();
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("EFT 4411")).toBeVisible();

  await page.getByRole("button", { name: "Refund…" }).click();
  await page.getByLabel("How was it refunded?").fill("Sent back by EFT, the pages were dropped.");
  await page.getByRole("button", { name: "Mark as refunded" }).click();
  await expect(page.getByText("Marked as refunded. The invoice counts it no longer.")).toBeVisible();
  await expect(page.getByText("Awaiting payment")).toBeVisible();
  expect(
    await withDb((db) =>
      db.collection("audit_log").countDocuments({
        action: { $in: ["billing.payment.recorded", "billing.payment.refunded"] },
      }),
    ),
  ).toBe(2);
});

test("the owner sets up a care plan and issues its first invoice early", async ({ page }) => {
  await signInOwner(page.context());
  const client = await withDb((db) => db.collection("clients").findOne({ email: CLIENT_EMAIL }));
  await page.goto(`/admin/billing/recurring/new?client=${client!._id.toHexString()}`);
  await expect(page.getByRole("heading", { level: 1, name: "New recurring invoice" })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  await page.getByLabel("Title").fill("Care plan: {period}");
  await page.getByLabel("Line 1, description").fill("Updates, backups and fixes, {period}");
  await page.getByLabel("Line 1, unit price").fill("49");
  // The first one next month: it's issued by hand below, so the scheduler has nothing to do meanwhile.
  const next = new Date();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const nextOn = next.toISOString().slice(0, 10);
  await page.getByLabel("First invoice on").fill(nextOn);
  await page.getByRole("button", { name: "Create the plan" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Care plan: {period}" })).toBeVisible();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("button", { name: "Issue the next one now" }).click();
  await expect(page.getByText(`INV-2026-0003 is issued and on its way to ${CLIENT_EMAIL}.`)).toBeVisible();
  const month = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    next,
  );
  await expect(
    page.getByRole("link", { name: new RegExp(`INV-2026-0003.*Care plan: ${month}`) }),
  ).toBeVisible();

  await page.goto("/admin/billing/recurring");
  await expect(page.getByRole("link", { name: /Care plan: \{period\}/ })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test("the owner adds an expense and reads the finance pages", async ({ page }) => {
  await signInOwner(page.context());
  await page.goto("/admin/finance/expenses/new");
  expect(await axeViolations(page)).toEqual([]);
  await page.getByLabel("Amount").fill("100");
  await page.getByLabel("Currency").selectOption("EUR");
  await page.getByLabel("Paid to").fill("Hetzner");
  await page.getByLabel("Category").selectOption("hosting");
  await page.getByLabel("What for (optional)").fill("Servers for client sites");
  await page.getByRole("button", { name: "Add the expense" }).click();
  await expect(page).toHaveURL(/\/admin\/finance\/expenses\?month=\d{4}-\d{2}$/);
  await expect(page.getByRole("link", { name: /Hetzner/ })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  // TCMB's rates, from the mock: 40 lira to the dollar, 47 to the euro.
  await page.goto("/admin/finance/rates");
  await page.getByRole("button", { name: "Fetch the rates now" }).click();
  await expect(page.getByText(/^Done: latest bulletin \d{4}-\d{2}-\d{2}/)).toBeVisible();
  await expect(page.getByRole("cell", { name: "40.0000" }).first()).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  // $925 by crypto, and $500 by bank refunded the same day: ₺37,000 in; €100 out: ₺4,700.
  await page.goto("/admin/finance");
  await expect(page.getByRole("heading", { level: 1, name: "Finance" })).toBeVisible();
  await expect(page.getByText("₺37,000").first()).toBeVisible();
  await expect(page.getByText("₺4,700").first()).toBeVisible();
  await expect(page.getByText("₺32,300").first()).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await page.goto("/admin/finance/export");
  expect(await axeViolations(page)).toEqual([]);
  await page.getByLabel("Opens in").selectOption("standard");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download the CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^leffloard-finance-\d{4}-01-01-to-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = (await (await file.createReadStream()).toArray()).map(String).join("");
  expect(csv).toContain(
    ",Payment received,INV-2026-0001,Grace Hopper,Deposit: Shop rebuild,,Cryptocurrency (NOWPayments),",
  );
  expect(csv).toContain(",Expense,,Hetzner,Servers for client sites,Hosting and domains,,,EUR,-100.00,");
  expect(
    await withDb((db) => db.collection("audit_log").countDocuments({ action: "finance.exported" })),
  ).toBe(1);
});
