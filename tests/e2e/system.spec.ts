import { ObjectId } from "mongodb";
import { E2E_BASE_URL, E2E_MOCK_URL } from "./fixtures";
import { axeViolations, signInOwner, withDb } from "./helpers";
import { expect, test } from "./test";

// The System page: health, configuration, jobs and backups, and the error log and CSP reports, which the
// owner can clear after confirming it's them.

// One after the other: the second test clears the error log the first one checks.
test.describe.configure({ mode: "serial" });

test("an error logged while answering a request reaches the error log", async ({ page }) => {
  // An AI request that Anthropic refuses is logged as an error by the route that made it.
  const ai = await withDb((db) => db.collection("settings").findOne({ _id: "ai" as never }));
  await withDb((db) =>
    db.collection("settings").updateOne(
      { _id: "ai" as never },
      {
        $set: {
          enabled: true,
          model: "claude-opus-5",
          monthlyBudgetMicros: 50_000_000,
          fallbacks: false,
          autoTriage: false,
        },
        $setOnInsert: { version: 1 },
      },
      { upsert: true },
    ),
  );
  await signInOwner(page.context());
  await page.request.post(`${E2E_MOCK_URL}/control/anthropic`, { data: { fail: true } });
  try {
    const answer = await page.request.post("/admin/ai-stream", {
      headers: { origin: E2E_BASE_URL },
      data: { feature: "weekly" },
    });
    expect(answer.status()).toBe(200);
    expect(await answer.text()).toContain("Anthropic couldn't take the request");
  } finally {
    await page.request.post(`${E2E_MOCK_URL}/control/anthropic`, { data: { fail: false } });
    await withDb(async (db) => {
      if (ai) await db.collection("settings").replaceOne({ _id: "ai" as never }, ai);
      else await db.collection("settings").deleteOne({ _id: "ai" as never });
    });
  }
  await expect
    .poll(() => withDb((db) => db.collection("error_log").countDocuments({ message: "AI request failed" })))
    .toBeGreaterThan(0);
  await page.goto("/admin/system");
  await expect(page.getByText("AI request failed").first()).toBeVisible();
});

test("the System page shows the server's state, and clears its logs", async ({ page }) => {
  const marker = `E2E failure ${Date.now().toString(36)}`;
  await withDb(async (db) => {
    await db.collection("error_log").insertOne({
      _id: new ObjectId(),
      at: new Date(),
      level: "error",
      message: marker,
      error: { type: "TypeError", message: "x is undefined", stack: "TypeError: x is undefined\n    at e2e" },
      context: { job: "e2e" },
      purgeAt: new Date(Date.now() + 3600_000),
    });
    await db.collection("csp_reports").insertOne({
      documentUrl: "http://localhost:3100/work",
      directive: "script-src-elem",
      blockedUrl: "https://evil.example/e2e.js",
      sourceFile: "",
      line: null,
      disposition: "enforce",
      sample: "",
      receivedAt: new Date(),
      userAgent: "e2e",
    });
  });

  await signInOwner(page.context());
  await page.goto("/admin/system");
  await expect(page.getByRole("heading", { name: "System", level: 1 })).toBeVisible();
  for (const title of ["Health", "Storage", "Configuration", "Background jobs", "Backups", "Errors"]) {
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  }
  await expect(page.getByText("answers in")).toBeVisible();
  await expect(page.getByText(marker)).toBeVisible();
  await expect(page.getByText("https://evil.example/e2e.js")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("button", { name: "Clear the error log" }).click();
  await expect(page.getByText(/^\d+ errors? cleared\.$/)).toBeVisible();
  await expect(page.getByText(marker)).toBeHidden();
  await page.getByRole("button", { name: "Clear the reports" }).click();
  await expect(page.getByText(/^\d+ reports? cleared\.$/)).toBeVisible();
  const audit = await withDb((db) =>
    db
      .collection("audit_log")
      .countDocuments({ action: { $in: ["system.errors.cleared", "system.csp.cleared"] } }),
  );
  expect(audit).toBeGreaterThanOrEqual(2);

  // Settings no longer carries the backups and jobs, and points here.
  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { name: "Background jobs" })).toBeHidden();
  await expect(page.getByRole("link", { name: "System", exact: true }).first()).toBeVisible();
});
