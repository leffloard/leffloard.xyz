import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { clearIntakeLimits, withDb } from "./helpers";
import { expect, test } from "./test";

// The public contact form, end to end: browser validation, the API, and the stored message.

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await clearIntakeLimits();
});

async function axeViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  return result.violations.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(" ")}`,
  );
}

const inquiriesFrom = (email: string) => withDb((db) => db.collection("inquiries").find({ email }).toArray());

test("a project brief takes three short steps and reaches the inbox", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/contact");
  const form = page.getByRole("form", { name: "Contact form" });
  await expect(form.getByRole("radio", { name: /Start a project/ })).toBeChecked();
  await expect(form.getByText("Step 1 of 3")).toBeVisible();

  // Nothing filled in: the step explains what is missing and stays put.
  await form.getByRole("button", { name: "Continue" }).click();
  await expect(form.getByText("Choose the kind of project.")).toBeVisible();
  await expect(form.getByText("Please sum up the project in one line.")).toBeVisible();
  await expect(form.getByLabel("The project in one line")).toHaveAttribute("aria-invalid", "true");
  expect(await axeViolations(page)).toEqual([]);

  await form.getByText("Discord bots", { exact: true }).click();
  await form.getByLabel("The project in one line").fill("Moderation bot for my server");
  await form
    .getByLabel("What should it do, and who is it for?")
    .fill("Warn, mute and log. About 2,000 members.");
  await form.getByRole("button", { name: "Continue" }).click();

  await expect(form.getByText("Step 2 of 3")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scope" })).toBeFocused();
  await form.getByText("$500 to $1,500").click();
  await form.getByText("Within a month").click();
  await form.getByRole("button", { name: "Continue" }).click();

  await expect(form.getByText("Step 3 of 3")).toBeVisible();
  await form.getByRole("button", { name: "Back" }).click();
  await expect(form.getByRole("radio", { name: "$500 to $1,500" })).toBeChecked();
  await form.getByRole("button", { name: "Continue" }).click();

  await form.getByLabel("Your name").fill("Alan Turing");
  await form.getByLabel("Email", { exact: true }).fill("alan.brief@example.com");
  await form.getByRole("checkbox", { name: /Don't use AI tools/ }).check();
  await form.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByRole("heading", { name: "Thanks, Alan. Your message is in." })).toBeFocused();
  const [stored] = await inquiriesFrom("alan.brief@example.com");
  expect(stored).toMatchObject({
    kind: "brief",
    source: "form",
    service: "discord-bots",
    budget: "500-1500",
    timeline: "1-month",
    aiOptOut: true,
    subject: "Moderation bot for my server",
  });
});

test.describe("with the visitor's clock in Istanbul", () => {
  test.use({ timezoneId: "Europe/Istanbul" });

  test("a call request offers the visitor's time zone and stores the slot", async ({ page }) => {
    await page.goto("/contact?type=appointment");
    const form = page.getByRole("form", { name: "Contact form" });
    await expect(form.getByRole("radio", { name: /Request a call/ })).toBeChecked();
    await expect(form.getByLabel("Your time zone")).toHaveValue("Europe/Istanbul");

    const date = await page.evaluate(() => {
      const day = new Date(Date.now() + 7 * 86_400_000);
      return day.toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
    });
    await form.getByLabel("Subject", { exact: true }).fill("Kickoff call");
    await form.getByLabel("What would you like to talk about?").fill("The new landing page.");
    await form.getByLabel("Date", { exact: true }).fill(date);
    await form.getByLabel("Time", { exact: true }).fill("14:30");
    await form.getByText("45 minutes").click();
    await form.getByLabel("Your name").fill("Ada Lovelace");
    await form.getByLabel("Email", { exact: true }).fill("ada.call@example.com");
    expect(await axeViolations(page)).toEqual([]);
    await form.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByRole("heading", { name: "Thanks, Ada. Your message is in." })).toBeVisible();
    const [stored] = await inquiriesFrom("ada.call@example.com");
    expect(stored).toMatchObject({
      kind: "call",
      call: { timeZone: "Europe/Istanbul", date, time: "14:30", duration: 45 },
    });
  });
});

test("a question is one step, and the server's field errors show up in the form", async ({ page }) => {
  await page.goto("/contact?type=question");
  const form = page.getByRole("form", { name: "Contact form" });
  await expect(form.getByRole("radio", { name: /Ask a question/ })).toBeChecked();
  await form.getByLabel("Subject", { exact: true }).fill("Pricing");
  await form.getByLabel("Your question").fill("Do you build Telegram bots too?");
  await form.getByLabel("Your name").fill("Grace Hopper");
  await form.getByLabel("Email", { exact: true }).fill("grace@localhost");
  await form.getByRole("button", { name: "Send message" }).click();
  // The browser check catches it first, with the server's own wording.
  await expect(form.getByText("Please enter a valid email address.")).toBeVisible();

  await form.getByLabel("Email", { exact: true }).fill("grace.question@example.com");
  await form.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("heading", { name: "Thanks, Grace. Your message is in." })).toBeVisible();
  await page.getByRole("button", { name: "Send another message" }).click();
  await expect(form.getByLabel("Your name")).toHaveValue("");
  expect(await inquiriesFrom("grace.question@example.com")).toHaveLength(1);
});
