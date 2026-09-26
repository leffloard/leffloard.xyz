import { readdirSync } from "node:fs";
import { E2E_BACKUP_DIR } from "./fixtures";
import { signInOwner } from "./helpers";
import { expect, test } from "./test";

// Settings: backups and background jobs. Runs with the other admin modules (see playwright.config.ts).

test.beforeEach(async ({ context }) => {
  await signInOwner(context);
});

test("back up now writes an encrypted backup and lists it", async ({ page }) => {
  await page.goto("/admin/settings");
  const card = page.locator("section", { has: page.getByRole("heading", { name: "Backups" }) });
  await expect(card.getByText(/Encrypted, every night from 03:15/)).toBeVisible();

  await card.getByRole("button", { name: "Back up now" }).click();
  await expect(card.getByText(/^Backup written: leffloard-leffloard_e2e-\d{8}T\d{6}Z\.lfbak/)).toBeVisible();
  await expect(card.getByText("up to date")).toBeVisible();
  // The nightly job may also have run during the tests (it catches up after 03:15), so at least one.
  await expect(card.locator("li").first()).toContainText(/^leffloard-leffloard_e2e-\d{8}T\d{6}Z\.lfbak/);
  const files = readdirSync(E2E_BACKUP_DIR).filter((name) => name.endsWith(".lfbak"));
  expect(files.length).toBeGreaterThanOrEqual(1);
  expect(await card.locator("li").count()).toBe(files.length);

  const jobs = page.locator("section", { has: page.getByRole("heading", { name: "Background jobs" }) });
  await expect(jobs.getByText("backup", { exact: true })).toBeVisible();
  await expect(jobs.getByText("ok", { exact: true })).toBeVisible();
});
