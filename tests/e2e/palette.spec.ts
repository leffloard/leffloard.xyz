import type { Page } from "@playwright/test";
import { E2E_BASE_URL } from "./fixtures";
import { axeViolations, clearIntakeLimits, signInOwner } from "./helpers";
import { expect, test } from "./test";

// Ctrl+K, again until the palette opens: the shortcut works once the page's scripts have started.
async function openPalette(page: Page) {
  const box = page.getByRole("combobox", { name: "Search, or jump to a page" });
  await expect(async () => {
    if (!(await box.isVisible())) await page.keyboard.press("Control+k");
    await expect(box).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return box;
}

// The command palette and the keyboard shortcuts: Ctrl+K jumps to a page or finds a message by name, g and
// c shortcuts go somewhere or start something, and ? lists them.

test("Ctrl+K finds pages and records, and the shortcuts move around the admin", async ({ page, request }) => {
  await clearIntakeLimits();
  const subject = `Palette check ${Date.now().toString(36)}`;
  const sent = await request.post("/api/inquiries", {
    headers: { origin: E2E_BASE_URL },
    data: {
      kind: "question",
      name: "Hedy Lamarr",
      email: "hedy.palette@example.com",
      subject,
      message: "Could you build a frequency-hopping bot?",
    },
  });
  expect(sent.status()).toBe(201);

  await signInOwner(page.context());
  await page.goto("/admin");
  const box = await openPalette(page);
  await expect(box).toBeFocused();
  await expect(page.getByRole("option", { name: /Inbox/ })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  // A page, by part of its name.
  await box.fill("analyt");
  await expect(page.getByRole("option", { name: /Analytics/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/analytics$/);
  await expect(box).toBeHidden();

  // A message, by its subject.
  await page.getByRole("button", { name: "Search the admin" }).click();
  await box.fill(subject);
  const hit = page.getByRole("option", { name: new RegExp(`Hedy Lamarr: ${subject}`) });
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(page.getByRole("heading", { name: subject })).toBeVisible();

  // Escape closes it and gives the focus back.
  await openPalette(page);
  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();

  // g t: the tasks; c t: a new task, with the box ready.
  await page.keyboard.press("g");
  await page.keyboard.press("t");
  await expect(page).toHaveURL(/\/admin\/tasks$/);
  await page.keyboard.press("c");
  await page.keyboard.press("t");
  await expect(page).toHaveURL(/\/admin\/tasks\?new=1$/);
  await expect(page.getByRole("textbox", { name: "New task" })).toBeFocused();
  // Typing in a field isn't a shortcut.
  await page.keyboard.type("g i");
  await expect(page).toHaveURL(/\/admin\/tasks\?new=1$/);
  await expect(page.getByRole("textbox", { name: "New task" })).toHaveValue("g i");

  // ? lists the shortcuts; the page's own keys don't act behind it (n would jump to the task box).
  await page.getByRole("textbox", { name: "New task" }).fill("");
  await page.getByRole("heading", { name: "Tasks", level: 1 }).click();
  await page.keyboard.press("?");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(help).toBeVisible();
  await expect(help.getByText("Analytics")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  await page.keyboard.press("n");
  await page.keyboard.press("Tab");
  await expect(help.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  await expect(page.getByRole("textbox", { name: "New task" })).not.toBeFocused();

  // A click in the palette's list keeps the keys in the palette.
  await openPalette(page);
  await page.getByRole("group", { name: "Go to" }).getByText("Go to").click({ force: true });
  await expect(box).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();
});
