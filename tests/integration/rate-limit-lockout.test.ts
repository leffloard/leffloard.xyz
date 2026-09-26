import { afterEach, describe, expect, it } from "vitest";
import { resetClock, setClock } from "@/server/clock";
import { clearLoginFailures, lockedUntil, recordLoginFailure } from "@/server/security/lockout";
import { hitRateLimit, releaseRateLimit } from "@/server/security/rate-limit";
import { setupTestDb } from "./db";

const { db } = setupTestDb();

let current = new Date("2026-09-26T10:00:00Z");
function at(offsetSeconds: number) {
  current = new Date(new Date("2026-09-26T10:00:00Z").getTime() + offsetSeconds * 1000);
  setClock(() => current);
}

afterEach(() => resetClock());

describe("hitRateLimit (same rules as the v1 limiter)", () => {
  it("allows `limit` hits per window, reports the wait, and forgets released hits", async () => {
    const limit = { limit: 2, windowMs: 60_000 };
    at(0);
    expect(await hitRateLimit(db(), "a", limit)).toEqual({ allowed: true });
    expect(await hitRateLimit(db(), "a", limit)).toEqual({ allowed: true });
    expect(await hitRateLimit(db(), "a", limit)).toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect(await hitRateLimit(db(), "b", limit)).toEqual({ allowed: true });
    at(30);
    expect(await hitRateLimit(db(), "a", limit)).toEqual({ allowed: false, retryAfterSeconds: 30 });
    await releaseRateLimit(db(), "a");
    expect(await hitRateLimit(db(), "a", limit)).toEqual({ allowed: true });
    at(91);
    expect(await hitRateLimit(db(), "a", limit)).toEqual({ allowed: true });
  });

  it("holds under concurrent hits", async () => {
    at(0);
    const results = await Promise.all(
      Array.from({ length: 25 }, () => hitRateLimit(db(), "burst", { limit: 10, windowMs: 60_000 })),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(10);
  });
});

describe("login lockout", () => {
  it("locks from the 5th failure: 15 minutes, then an hour from the 10th, a day from the 20th", async () => {
    at(0);
    for (let failure = 1; failure <= 4; failure++) {
      expect(await recordLoginFailure(db(), "Owner@Example.com ")).toEqual({
        failures: failure,
        lockedUntil: null,
      });
    }
    const fifth = await recordLoginFailure(db(), "owner@example.com");
    expect(fifth.failures).toBe(5);
    expect(fifth.lockedUntil?.getTime()).toBe(current.getTime() + 15 * 60_000);
    expect(await lockedUntil(db(), "OWNER@example.com")).toEqual(fifth.lockedUntil);

    at(16 * 60);
    expect(await lockedUntil(db(), "owner@example.com")).toBeNull();
    for (let failure = 6; failure <= 9; failure++) await recordLoginFailure(db(), "owner@example.com");
    const tenth = await recordLoginFailure(db(), "owner@example.com");
    expect(tenth.lockedUntil?.getTime()).toBe(current.getTime() + 60 * 60_000);

    for (let failure = 11; failure <= 19; failure++) await recordLoginFailure(db(), "owner@example.com");
    const twentieth = await recordLoginFailure(db(), "owner@example.com");
    expect(twentieth.lockedUntil?.getTime()).toBe(current.getTime() + 24 * 60 * 60_000);
  });

  it("forgets failures after a quiet day, and on request", async () => {
    at(0);
    for (let failure = 1; failure <= 4; failure++) await recordLoginFailure(db(), "a@example.com");
    at(25 * 3600);
    expect(await recordLoginFailure(db(), "a@example.com")).toEqual({ failures: 1, lockedUntil: null });

    for (let failure = 2; failure <= 5; failure++) await recordLoginFailure(db(), "a@example.com");
    expect(await lockedUntil(db(), "a@example.com")).not.toBeNull();
    await clearLoginFailures(db(), "a@example.com");
    expect(await lockedUntil(db(), "a@example.com")).toBeNull();
  });
});
