import { readFileSync } from "node:fs";
import { MongoClient, type Db } from "mongodb";
import type { Page } from "@playwright/test";
import { base32Decode } from "@/lib/base32";
import { hotp, totpStep } from "@/lib/totp";
import { E2E_DB_NAME, E2E_MONGO_URL_FILE, OWNER } from "./fixtures";

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
