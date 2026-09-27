import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { handleNowPaymentsIpn } from "@/server/billing/ipn";
import { closeClient } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { readChannels } from "@/server/notify/channels";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

// Forged callbacks are logged for the owner, but at most 500 a day (Istanbul time): anyone can send them.
// A file of its own, as the count is kept in the module.

const { db, url, name } = setupTestDb();
setupTestEnv({ MONGO_URL: url, DB_NAME: name, EMAIL_DELIVERY: "log" });

beforeEach(async () => {
  await runMigrations(db());
});

afterAll(async () => {
  await closeClient();
});

const CONFIG = {
  apiKey: "api-key-for-tests",
  ipnSecret: "ipn-secret-for-tests",
  apiUrl: "https://np.test/v1",
};
const forged = (n: number) => JSON.stringify({ payment_id: 5_600_000_000 + n, payment_status: "finished" });
const rejected = () => db().collection("payment_events").countDocuments({ signatureOk: false });

describe("forged NOWPayments callbacks", () => {
  it("are refused, and logged at most 500 times a day", async () => {
    const notify = { siteUrl: "https://leffloard.test", channels: readChannels() };
    // 23:30 on the 28th in Istanbul.
    const evening = new Date("2026-09-28T20:30:00Z");
    for (let n = 0; n < 502; n++) {
      const result = await handleNowPaymentsIpn(db(), forged(n), "0".repeat(128), CONFIG, notify, evening);
      expect(result).toEqual({ status: 401, outcome: "rejected" });
    }
    expect(await rejected()).toBe(500);

    // 00:30 on the 29th in Istanbul, while it is still the 28th in UTC: a new day's allowance.
    const nextDay = new Date("2026-09-28T21:30:00Z");
    await handleNowPaymentsIpn(db(), forged(600), "0".repeat(128), CONFIG, notify, nextDay);
    expect(await rejected()).toBe(501);
  });
});
