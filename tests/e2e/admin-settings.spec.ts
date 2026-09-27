import { readdirSync } from "node:fs";
import { E2E_BACKUP_DIR } from "./fixtures";
import { signInOwner } from "./helpers";
import { expect, test } from "./test";

// Backups and background jobs, on the System page. Runs with the other admin modules (see
// playwright.config.ts).

test.beforeEach(async ({ context }) => {
  await signInOwner(context);
});

test("back up now writes an encrypted backup and lists it", async ({ page }) => {
  await page.goto("/admin/system");
  const card = page.locator("section", { has: page.getByRole("heading", { name: "Backups" }) });
  await expect(card.getByText(/Encrypted, every night from 03:15/)).toBeVisible();

  await card.getByRole("button", { name: "Back up now" }).click();
  await expect(card.getByText(/^Backup written: leffloard-leffloard_e2e-\d{8}T\d{6}Z\.lfbak/)).toBeVisible();
  await expect(card.getByText("up to date")).toBeVisible();
  await expect(card.locator("li").first()).toContainText(/^leffloard-leffloard_e2e-\d{8}T\d{6}Z\.lfbak/);
  // The nightly job may write one too, even during this test: it checks every quarter of an hour and catches
  // up after 03:15. So the page lists what the folder holds once both are read after its last file.
  await expect(async () => {
    await page.reload();
    const files = readdirSync(E2E_BACKUP_DIR).filter((name) => name.endsWith(".lfbak"));
    expect(files.length).toBeGreaterThanOrEqual(1);
    await expect(card.locator("li")).toHaveCount(files.length, { timeout: 1000 });
  }).toPass();

  // Other jobs may have run by now too, each with its own "ok": look at the backup's row.
  const jobs = page.locator("section", { has: page.getByRole("heading", { name: "Background jobs" }) });
  const backupJob = jobs.locator("li", { has: page.getByText("backup", { exact: true }) });
  await expect(backupJob.getByText("ok", { exact: true })).toBeVisible();
});
