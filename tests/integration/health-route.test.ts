import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
import { closeClient, getDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { TEST_ENCRYPTION_KEYS } from "../helpers/env";
import { setupTestDb } from "./db";

const TOKEN = "health-token-for-integration-tests";
const { url, name } = setupTestDb();

beforeAll(() => {
  vi.stubEnv("DATA_ENCRYPTION_KEYS", TEST_ENCRYPTION_KEYS);
  vi.stubEnv("MONGO_URL", url);
  vi.stubEnv("DB_NAME", name);
  vi.stubEnv("HEALTH_TOKEN", TOKEN);
});

afterAll(async () => {
  await closeClient();
  vi.unstubAllEnvs();
});

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return GET(new Request(`http://localhost${path}`, { headers }));
}

describe("GET /api/health", () => {
  it("answers the shallow check without a token and never caches it", async () => {
    const response = await get("/api/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("refuses the deep check without the right token", async () => {
    const attempts: Record<string, string>[] = [{}, { "x-health-token": "wrong-token-wrong-token-wrong" }];
    for (const headers of attempts) {
      const response = await get("/api/health?deep=1", headers);
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ ok: false, error: "forbidden" });
    }
  });

  it("reports pending migrations with 503, then ok once they are applied", async () => {
    const before = await get("/api/health?deep=1", { "x-health-token": TOKEN });
    expect(before.status).toBe(503);
    await expect(before.json()).resolves.toMatchObject({
      ok: false,
      checks: { env: "ok", db: "ok", migrations: "pending" },
    });

    await runMigrations(await getDb());

    const after = await get("/api/health?deep=1", { "x-health-token": TOKEN });
    expect(after.status).toBe(200);
    await expect(after.json()).resolves.toMatchObject({
      ok: true,
      version: expect.stringMatching(/^2\.0\.0/),
      checks: { env: "ok", db: "ok", migrations: "ok" },
    });
  });
});
