import { E2E_BASE_URL, OWNER } from "./fixtures";
import { freshTotp, signInWithRecoveryCode, submitPassword, withDb } from "./helpers";
import { expect, test, watchPage } from "./test";

// One owner account, one story: set up two-step sign-in, then use every way in and out. Serial, because
// each step builds on the account state the previous one left.
test.describe.configure({ mode: "serial" });

let secret = "";
let recoveryCodes: string[] = [];

test("the admin asks for a sign-in and runs under a nonce-based CSP", async ({ page }) => {
  const response = await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  const headers = response!.headers();
  expect(headers["content-security-policy"]).toMatch(
    /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/,
  );
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
  const scriptsWithoutNonce = await page
    .locator("script")
    .evaluateAll((scripts) => scripts.filter((script) => !(script as HTMLScriptElement).nonce).length);
  expect(scriptsWithoutNonce).toBe(0);
});

test("the first sign-in sets up the authenticator app and shows recovery codes once", async ({ page }) => {
  await submitPassword(page);
  await expect(page).toHaveURL(/\/admin\/setup$/);
  secret = (await page.getByTestId("totp-secret").textContent())!.replace(/\s/g, "");
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);

  await page.getByLabel("Code from the app").fill("000000");
  await page.getByRole("button", { name: "Turn on two-step sign-in" }).click();
  await expect(page.getByText(/That code didn't match/)).toBeVisible();

  await page.getByLabel("Code from the app").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "Turn on two-step sign-in" }).click();
  await expect(page.getByText("Two-step sign-in is on.")).toBeVisible();
  recoveryCodes = await page.getByTestId("recovery-codes").locator("li").allTextContents();
  expect(recoveryCodes).toHaveLength(10);

  await page.getByRole("link", { name: "Continue to the admin" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/, Test$/);
});

test("password plus authenticator code; wrong codes count down", async ({ page }) => {
  await submitPassword(page);
  await expect(page).toHaveURL(/\/admin\/login\/verify$/);
  await page.getByLabel("Code").fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("That code didn't work. 4 tries left.")).toBeVisible();

  await page.getByLabel("Code").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(`${E2E_BASE_URL}/admin`);

  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.goto("/admin/security");
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("a recovery code signs in exactly once", async ({ page }) => {
  await signInWithRecoveryCode(page, recoveryCodes[0]!);
  await expect(page).toHaveURL(/\/admin\/security\?recovery=used$/);
  await expect(page.getByText("You signed in with a recovery code. 9 left.")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).first().click();
  await signInWithRecoveryCode(page, recoveryCodes[0]!);
  await expect(page.getByText(/That code didn't work/)).toBeVisible();
});

test("sign out other devices, and confirm it's you before sensitive changes", async ({ page, browser }) => {
  await signInWithRecoveryCode(page, recoveryCodes[1]!);
  await expect(page).toHaveURL(/\/admin\/security/);

  const other = await browser.newContext({ baseURL: E2E_BASE_URL });
  const otherPage = await other.newPage();
  const otherErrors: string[] = [];
  watchPage(otherPage, otherErrors);
  await signInWithRecoveryCode(otherPage, recoveryCodes[2]!);
  await expect(otherPage).toHaveURL(/\/admin\/security/);

  await page.reload();
  await page.getByRole("button", { name: "Sign out everywhere else" }).click();
  await expect(page.getByText(/sessions? signed out\./)).toBeVisible();
  await otherPage.goto("/admin");
  await expect(otherPage).toHaveURL(/\/admin\/login$/);
  expect(otherErrors).toEqual([]);
  await other.close();

  // Ten minutes after signing in, sensitive changes ask again.
  await withDb((db) => db.collection("sessions").updateMany({}, { $set: { sudoUntil: null } }));
  await page.getByRole("button", { name: "Create new codes" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Password").fill("not my password");
  await dialog.getByLabel("Authenticator code").fill(recoveryCodes[3]!);
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(dialog.getByText("The password or the code is not correct.")).toBeVisible();

  await dialog.getByLabel("Password").fill(OWNER.password);
  await dialog.getByLabel("Authenticator code").fill(await freshTotp(secret));
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(dialog).toBeHidden();

  const fresh = await page.getByTestId("recovery-codes").locator("li").allTextContents();
  expect(fresh).toHaveLength(10);
  expect(fresh).not.toContain(recoveryCodes[4]);
  recoveryCodes = fresh;
  await expect(page.getByText("10 of 10 left")).toBeVisible();
});

test("add a passkey, then sign in with it alone", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await signInWithRecoveryCode(page, recoveryCodes[0]!);
  await expect(page).toHaveURL(/\/admin\/security/);
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByText(/^Passkey added: /)).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).toHaveURL(`${E2E_BASE_URL}/admin`);
  await expect(page.getByText("Passkeys")).toBeVisible();

  const methods = await withDb((db) =>
    db
      .collection("sessions")
      .find({}, { projection: { methods: 1 } })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray(),
  );
  expect(methods[0]?.methods).toEqual(["passkey"]);
});

test("repeated wrong passwords lock password sign-in for that address", async ({ page }) => {
  for (let attempt = 1; attempt <= 4; attempt++) {
    await submitPassword(page, "intruder@example.com", `wrong password ${attempt}`);
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  }
  await submitPassword(page, "intruder@example.com", "wrong password 5");
  await expect(page.getByText(/Too many failed attempts\. Password sign-in is paused until/)).toBeVisible();

  const locked = await withDb((db) =>
    db.collection("audit_log").countDocuments({ action: "auth.login.locked" }),
  );
  expect(locked).toBe(1);
});
