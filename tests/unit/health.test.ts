import { describe, expect, it } from "vitest";
import type { EnvReport } from "@/server/env";
import { deepHealth, tokenMatches, type HealthDeps } from "@/server/health";

const OK_ENV: EnvReport = {
  ok: true,
  warnings: [],
  env: {
    NODE_ENV: "test",
    MONGO_URL: "mongodb://127.0.0.1:27017",
    DB_NAME: "leffloard",
    SITE_URL: "http://localhost:3000",
    HEALTH_TOKEN: undefined,
    LOG_LEVEL: "info",
  },
};

function deps(overrides: Partial<HealthDeps> = {}): HealthDeps {
  return {
    envReport: () => OK_ENV,
    pingDb: async () => {},
    pendingMigrationCount: async () => 0,
    version: "2.0.0-test",
    timeoutMs: 50,
    ...overrides,
  };
}

describe("deepHealth", () => {
  it("is ok when every check passes", async () => {
    await expect(deepHealth(deps())).resolves.toEqual({
      ok: true,
      version: "2.0.0-test",
      checks: { env: "ok", db: "ok", migrations: "ok" },
    });
  });

  it("skips the database when the configuration is broken", async () => {
    let pinged = false;
    const result = await deepHealth(
      deps({
        envReport: () => ({ ok: false, problems: ["MONGO_URL is missing."], warnings: [] }),
        pingDb: async () => {
          pinged = true;
        },
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      checks: { env: "error", db: "skipped", migrations: "skipped" },
    });
    expect(pinged).toBe(false);
  });

  it("reports an unreachable or hanging database", async () => {
    const failing = await deepHealth(deps({ pingDb: () => Promise.reject(new Error("ECONNREFUSED")) }));
    expect(failing.checks).toEqual({ env: "ok", db: "error", migrations: "skipped" });

    const hanging = await deepHealth(deps({ pingDb: () => new Promise(() => {}) }));
    expect(hanging).toMatchObject({ ok: false, checks: { db: "error", migrations: "skipped" } });
  });

  it("reports pending and failing migration checks", async () => {
    const pending = await deepHealth(deps({ pendingMigrationCount: async () => 2 }));
    expect(pending).toMatchObject({ ok: false, checks: { db: "ok", migrations: "pending" } });

    const failing = await deepHealth(
      deps({ pendingMigrationCount: () => Promise.reject(new Error("boom")) }),
    );
    expect(failing).toMatchObject({ ok: false, checks: { db: "ok", migrations: "error" } });
  });
});

describe("tokenMatches", () => {
  const token = "a".repeat(32);

  it("accepts only the exact token", () => {
    expect(tokenMatches(token, token)).toBe(true);
    expect(tokenMatches(`${token}b`, token)).toBe(false);
    expect(tokenMatches("A".repeat(32), token)).toBe(false);
    expect(tokenMatches("short", token)).toBe(false);
  });

  it("refuses when either side is missing", () => {
    expect(tokenMatches(null, token)).toBe(false);
    expect(tokenMatches("", token)).toBe(false);
    expect(tokenMatches(token, undefined)).toBe(false);
    expect(tokenMatches(token, "")).toBe(false);
  });
});
