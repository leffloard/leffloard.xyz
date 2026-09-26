import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";
import { E2E_BASE_URL } from "./fixtures";
import { clearIntakeLimits, signInOwner, withDb } from "./helpers";
import { expect, test } from "./test";

// The inbox, from a message arriving to replying, organising and deleting it. Runs after the other
// browser tests (see playwright.config.ts): admin-auth.spec.ts signs out every other session.

test.describe.configure({ mode: "serial" });

async function sendMessage(request: APIRequestContext, overrides: Record<string, unknown>): Promise<void> {
  const response = await request.post("/api/inquiries", {
    headers: { origin: E2E_BASE_URL },
    data: {
      kind: "question",
      name: "Alan Turing",
      email: "alan.inbox@example.com",
      subject: "Discord bot pricing",
      message: "How much would a moderation bot cost? Details: https://example.com/brief",
      ...overrides,
    },
  });
  expect(response.status()).toBe(201);
}

async function axeViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  return result.violations.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(" ")}`,
  );
}

test.beforeAll(async ({ request }) => {
  await withDb(async (db) => {
    await db.collection("inquiries").deleteMany({});
    await db.collection("outbox").deleteMany({});
    await db.collection("blocklist").deleteMany({});
  });
  await clearIntakeLimits();
  await sendMessage(request, {});
  await sendMessage(request, { name: "Spam Bot", email: "bot@spam.example", subject: "Cheap followers" });
});

test.beforeEach(async ({ context }) => {
  await signInOwner(context);
});

test("new messages show in the inbox, with a count in the menu", async ({ page }) => {
  await page.goto("/admin");
  const nav = page.getByRole("navigation", { name: "Admin" }).first();
  await expect(nav.getByRole("link", { name: /Inbox\s*2 new/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();

  await nav.getByRole("link", { name: /Inbox/ }).click();
  await expect(page).toHaveURL(/\/admin\/inbox$/);
  const rows = page.locator("a[data-row]");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Spam Bot");
  expect(await axeViolations(page)).toEqual([]);

  // j and k move between messages.
  await page.keyboard.press("j");
  await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press("j");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("k");
  await expect(rows.nth(0)).toBeFocused();

  await page.getByLabel("Search messages").fill("alan.inbox");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Alan Turing");
});

test("open a message, reply, label and snooze it", async ({ page }) => {
  await page.goto("/admin/inbox?q=alan.inbox");
  await page.locator("a[data-row]").first().click();
  await expect(page.getByRole("heading", { name: "Discord bot pricing" })).toBeVisible();
  await expect(page.getByRole("link", { name: "https://example.com/brief" })).toHaveAttribute(
    "rel",
    "noopener noreferrer nofollow",
  );
  expect(await axeViolations(page)).toEqual([]);

  await expect(page.getByLabel("Subject")).toHaveValue("Re: Discord bot pricing");
  await page.getByLabel("Message", { exact: true }).fill("Hi Alan,\nA moderation bot starts at $180.");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText(/Reply queued\./)).toBeVisible();
  // Replying opens a new message.
  await expect(page.getByRole("button", { name: "Back to new" })).toBeVisible();
  await expect
    .poll(async () => {
      await page.reload();
      return page.getByText("sent", { exact: true }).count();
    })
    .toBeGreaterThan(0);

  await page.getByLabel("Labels").fill("pricing, Bots");
  await page.getByRole("button", { name: "Save labels" }).click();
  await expect(page.getByText("Labels saved.")).toBeVisible();

  await page.getByLabel("Snooze until").selectOption("tomorrow");
  await page.getByRole("button", { name: "Snooze", exact: true }).click();
  await expect(page.getByText(/Snoozed until/)).toBeVisible();

  await page.goto("/admin/inbox");
  await expect(page.locator("a[data-row]")).toHaveCount(1);
  await page.getByRole("link", { name: /Snoozed/ }).click();
  await expect(page.locator("a[data-row]").first()).toContainText("pricing");

  const stored = await withDb((db) =>
    db.collection("inquiries").findOne({ email: "alan.inbox@example.com" }),
  );
  expect(stored).toMatchObject({ status: "open", labels: ["pricing", "bots"] });
  expect(stored?.replies).toHaveLength(1);
});

test("mark spam and block the sender, then unblock them in Settings", async ({ page }) => {
  await page.goto("/admin/inbox?q=Spam");
  await page.locator("a[data-row]").first().click();
  await page.getByLabel("Block the sender").selectOption("email");
  await page.getByRole("button", { name: "Spam", exact: true }).click();
  await expect(page.getByText(/Moved to spam/)).toBeVisible();

  await page.goto("/admin/settings");
  await expect(page.getByText("bot@spam.example")).toBeVisible();
  await expect(page.getByText("written to the server log (EMAIL_DELIVERY=log)")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Send a test email" }).click();
  await expect(page.getByText("Test email sent to owner@example.com.")).toBeVisible();
  await page.getByRole("button", { name: "Unblock" }).click();
  await expect(page.getByText("Nobody is blocked.")).toBeVisible();
});

test("delete a message for good", async ({ page }) => {
  await page.goto("/admin/inbox?view=spam");
  await page.locator("a[data-row]").first().click();
  await page.getByRole("button", { name: "Delete…" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/inbox$/);
  const left = await withDb((db) => db.collection("inquiries").countDocuments({ email: "bot@spam.example" }));
  expect(left).toBe(0);
  const deleted = await withDb((db) =>
    db.collection("audit_log").findOne({ action: "inbox.inquiry.deleted" }),
  );
  expect(deleted).not.toBeNull();
});
