import { expect, test } from "@playwright/test";
import { E2E_HEALTH_TOKEN } from "./fixtures";

test("home page renders without errors and with the security headers", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page).toHaveTitle(/Mert Kaan Koparan/);

  const headers = response!.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  expect(headers["x-powered-by"]).toBeUndefined();

  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});

test("unknown addresses get the 404 page", async ({ page }) => {
  const response = await page.goto("/this-page-does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "This page does not exist." })).toBeVisible();
  await page.getByRole("link", { name: "Go to the home page" }).click();
  await expect(page).toHaveURL("/");
});

test("health: the shallow check is public, the deep check needs the token", async ({ request }) => {
  const shallow = await request.get("/api/health");
  expect(shallow.status()).toBe(200);
  expect(shallow.headers()["cache-control"]).toBe("no-store");
  expect(await shallow.json()).toEqual({ ok: true });

  expect((await request.get("/api/health?deep=1")).status()).toBe(403);

  const deep = await request.get("/api/health?deep=1", { headers: { "x-health-token": E2E_HEALTH_TOKEN } });
  expect(deep.status()).toBe(200);
  expect(await deep.json()).toMatchObject({ ok: true, checks: { env: "ok", db: "ok", migrations: "ok" } });
});
