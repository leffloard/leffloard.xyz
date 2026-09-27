import type { APIRequestContext } from "@playwright/test";
import { E2E_BASE_URL } from "./fixtures";
import { axeViolations, clearIntakeLimits, signInOwner, withDb } from "./helpers";
import { expect, test } from "./test";

// The AI assistant against a mock of Anthropic's API (scripts/lib/e2e-mocks.ts): the owner switches it
// on, triages a message, takes a streamed reply draft into the reply, fills a quote from the catalogue,
// reads the usage and cost, and sees the budget and the switch stop it. Runs last (see
// playwright.config.ts): it adds inbox messages.

test.describe.configure({ mode: "serial" });

async function sendMessage(request: APIRequestContext, overrides: Record<string, unknown> = {}) {
  const response = await request.post("/api/inquiries", {
    headers: { origin: E2E_BASE_URL },
    data: {
      kind: "question",
      name: "Alan Turing",
      email: "alan.ai@example.com",
      subject: "Moderation bot",
      message: "We need a moderation bot for a 5,000-member Discord server within a month.",
      ...overrides,
    },
  });
  expect(response.status()).toBe(201);
}

async function messageId(subject: string): Promise<string> {
  return withDb(async (db) => {
    const doc = await db.collection("inquiries").findOne({ subject }, { sort: { receivedAt: -1 } });
    if (!doc) throw new Error(`No message "${subject}".`);
    return doc._id.toHexString();
  });
}

async function saveSettings(page: import("@playwright/test").Page, change: () => Promise<void>) {
  await page.goto("/admin/ai");
  await change();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/^Saved\. The AI assistant is (on|off)\.$/)).toBeVisible();
}

test.beforeAll(async ({ request }) => {
  await withDb(async (db) => {
    await db.collection("ai_runs").deleteMany({});
    await db.collection("ai_months").deleteMany({});
    await db.collection("settings").deleteOne({ _id: "ai" as never });
  });
  await clearIntakeLimits();
  await sendMessage(request);
  await sendMessage(request, {
    subject: "No robots please",
    email: "private.ai@example.com",
    message: "Please read this yourself: I'd like a quote for a small website.",
    aiOptOut: true,
  });
});

test.beforeEach(async ({ context }) => {
  await signInOwner(context);
});

test("the owner switches the assistant on and checks the key", async ({ page }) => {
  await page.goto("/admin/ai");
  await expect(page.getByRole("heading", { level: 1, name: "AI assistant" })).toBeVisible();
  await expect(page.getByText("API key set on the server.")).toBeVisible();
  await expect(page.getByLabel("The AI assistant is on")).not.toBeChecked();
  expect(await axeViolations(page)).toEqual([]);

  await page.getByLabel("The AI assistant is on").check();
  await page.getByLabel("Monthly budget (US dollars)").fill("5");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved. The AI assistant is on.")).toBeVisible();

  await page.getByRole("button", { name: "Check the key" }).click();
  await expect(page.getByText("The key works: Claude Opus 5 (claude-opus-5) is available.")).toBeVisible();
});

test("a message is triaged, and a streamed reply draft goes into the reply", async ({ page }) => {
  await page.goto(`/admin/inbox/${await messageId("Moderation bot")}`);
  await page.getByRole("button", { name: "Triage with AI" }).click();
  await expect(page.getByText("Triaged. These are suggestions: nothing was changed.")).toBeVisible();
  await expect(page.getByText("Wants a moderation bot for a large Discord server.")).toBeVisible();
  await expect(page.getByText("high priority")).toBeVisible();
  await expect(page.getByText("How many members does the server have?")).toBeVisible();
  await page.getByRole("button", { name: "Add these labels" }).click();
  await expect(page.getByText("Labels saved.")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await page.getByLabel("What should the reply say? (optional)").fill("Mention the Pro package");
  await page.getByRole("button", { name: "Draft a reply" }).click();
  const draft = page.getByRole("region", { name: "AI draft" });
  await expect(draft).toContainText("A moderation bot like this fits the Pro package, from $480.");
  await expect(page.getByText(/^Done · \$0\.\d{4}$/)).toBeVisible();
  await page.getByRole("button", { name: "Put it in the message" }).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    /^Hi Alan,\n\nThanks for your message\./,
  );

  // The inbox shows the triage beside the message.
  await page.goto("/admin/inbox");
  await expect(page.locator("a[data-row]", { hasText: "Moderation bot" })).toContainText(
    "New project · high",
  );
});

test("a sender who asked for no AI is never sent to it", async ({ page }) => {
  await page.goto(`/admin/inbox/${await messageId("No robots please")}`);
  await expect(
    page.getByText("The sender asked that AI tools don't process this message.").first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Triage with AI" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Draft a reply" })).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
});

test("a quote is drafted from the catalogue, never priced by the AI", async ({ page }) => {
  await page.goto(`/admin/billing/quotes/new?inquiry=${await messageId("Moderation bot")}`);
  await page.getByRole("button", { name: "Suggest lines with AI" }).click();
  await expect(
    page.getByText(/^Draft filled in \(\$0\.\d{4}\)\. Check every line and price before saving\.$/),
  ).toBeVisible();
  await expect(page.getByLabel("Line 1, description")).toHaveValue("Moderation bot with tickets and logging");
  await expect(page.getByLabel("Line 1, unit price")).toHaveValue("480");
  await expect(page.getByLabel("Line 2, description")).toHaveValue("Hosting setup");
  await expect(page.getByLabel("Line 2, unit price")).toHaveValue("");
  await expect(page.getByText("Which moderation rules do you need?")).toBeVisible();
});

test("the usage page shows each request, its cost and the cache", async ({ page }) => {
  await page.goto("/admin/ai");
  await expect(page.getByText("Inbox triage").first()).toBeVisible();
  await expect(page.getByText("Reply draft").first()).toBeVisible();
  await expect(page.getByText("Quote draft").first()).toBeVisible();
  // The shared part of the prompt was written to the cache once, then read from it.
  await expect(page.getByText(/from cache/).first()).toBeVisible();
  await page.locator("li", { hasText: "Reply draft" }).getByText("The draft").click();
  await expect(page.getByText("Pro package, from $480").first()).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test("the weekly review streams on Today", async ({ page }) => {
  await page.goto("/admin");
  await page.getByRole("button", { name: "Write this week's review" }).click();
  await expect(page.getByRole("region", { name: "AI draft" })).toContainText(
    "Answer new messages within a day.",
  );
});

test("the content editor rewrites a field and drafts a case study, unsaved", async ({ page }) => {
  await page.goto("/admin/content/work");
  await page.getByRole("link", { name: /MiniEngine/ }).click();
  await expect(page.getByRole("heading", { name: "AI writing help" })).toBeVisible();
  await page.getByLabel("How").selectOption({ label: "Tighter" });
  await page.getByRole("button", { name: 'Rewrite "Case study"' }).click();
  await page.getByRole("button", { name: "Replace the field" }).click();
  await expect(page.getByLabel("Case study", { exact: true })).toHaveValue("A tighter version of the text.");
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  await page
    .getByLabel(/^Facts sheet/)
    .fill("Project name: MiniEngine\nPublic or private: public\nStack: C++");
  await page.getByRole("button", { name: "Draft the case study" }).click();
  await page.getByRole("button", { name: "Use as the case study" }).click();
  await expect(page.getByLabel("Case study", { exact: true })).toHaveValue(/^A short opening paragraph\./);
  expect(await axeViolations(page)).toEqual([]);
});

test("the budget and the switch stop the assistant", async ({ page }) => {
  await saveSettings(page, () => page.getByLabel("Monthly budget (US dollars)").fill("0.01"));
  await page.goto(`/admin/inbox/${await messageId("Moderation bot")}`);
  await page.getByRole("button", { name: "Triage again" }).click();
  await expect(page.getByText(/^This month's AI budget is nearly used up/)).toBeVisible();

  await saveSettings(page, async () => {
    await page.getByLabel("Monthly budget (US dollars)").fill("5");
    await page.getByLabel("The AI assistant is on").uncheck();
  });
  await page.goto(`/admin/inbox/${await messageId("Moderation bot")}`);
  await expect(
    page.getByText("The AI assistant is switched off; turn it on in the AI settings.").first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Triage again" })).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
});
