import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";
import { MongoClient, type Db } from "mongodb";
import { base32Decode } from "@/lib/base32";
import { hotp, totpStep } from "@/lib/totp";
import { E2E_BASE_URL, E2E_DB_NAME, E2E_MONGO_URL_FILE, OWNER } from "./fixtures";

// Each authenticator code is accepted once, so every call returns a step the server has not seen yet:
// the current one, or the next (the server accepts one step of drift), waiting if both are used up.
let lastStep = 0;

export async function freshTotp(secret: string): Promise<string> {
  for (;;) {
    const current = totpStep(new Date());
    const step = Math.max(current, lastStep + 1);
    if (step <= current + 1) {
      lastStep = step;
      return hotp(base32Decode(secret), step);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

export async function withDb<T>(run: (db: Db) => Promise<T>): Promise<T> {
  const client = await new MongoClient(readFileSync(E2E_MONGO_URL_FILE, "utf8").trim()).connect();
  try {
    return await run(client.db(E2E_DB_NAME));
  } finally {
    await client.close();
  }
}

export async function submitPassword(
  page: Page,
  email: string = OWNER.email,
  password: string = OWNER.password,
) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
}

export async function signInWithRecoveryCode(page: Page, code: string) {
  await submitPassword(page);
  await page.getByRole("button", { name: "Lost your phone? Use a recovery code" }).click();
  await page.getByLabel("Recovery code").fill(code);
  await page.getByRole("button", { name: "Verify" }).click();
}

// A signed-in owner session, written straight to the database: for specs about admin pages other than
// the sign-in itself (admin-auth.spec.ts covers that).
export async function signInOwner(context: BrowserContext): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await withDb(async (db) => {
    const owner = await db.collection("users").findOne({ role: "owner" });
    if (!owner) throw new Error("The e2e server did not create the owner account.");
    const now = new Date();
    await db.collection<{ _id: string; [field: string]: unknown }>("sessions").insertOne({
      _id: createHash("sha256").update(token).digest("hex"),
      userId: owner._id,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + 12 * 3600_000),
      sudoUntil: new Date(now.getTime() + 10 * 60_000),
      ip: "127.0.0.1",
      userAgent: "playwright",
      methods: ["password", "totp"],
    });
  });
  // Over plain http the cookie has no __Host- prefix (see server/auth/cookies.ts).
  await context.addCookies([
    { name: "lf_session", value: token, url: E2E_BASE_URL, httpOnly: true, sameSite: "Lax" },
  ]);
}

// Every browser test comes from 127.0.0.1, so the contact form's per-address limit would carry over.
export async function clearIntakeLimits(): Promise<void> {
  await withDb((db) =>
    db.collection<{ _id: string }>("rate_limits").deleteMany({ _id: { $regex: "^intake:" } }),
  );
}

// WCAG 2.2 AA problems on the page, as "rule: selectors" lines (an empty list passes).
export async function axeViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  return result.violations.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(" ")}`,
  );
}
