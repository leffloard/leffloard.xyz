// Web server for the Playwright tests: a throwaway MongoDB with the migrations applied, and the
// production build started from the standalone output exactly as the VDS will run it.
// Needs "npm run build" first.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createOwner } from "@/server/auth/users";
import { seedContent } from "@/server/content/seed";
import { runMigrations } from "@/server/db/migrate";
import {
  E2E_BACKUP_DIR,
  E2E_BACKUP_KEY,
  E2E_BASE_URL,
  E2E_DB_NAME,
  E2E_ENCRYPTION_KEYS,
  E2E_HEALTH_TOKEN,
  E2E_MOCK_PORT,
  E2E_MOCK_URL,
  E2E_MONGO_URL_FILE,
  E2E_NOWPAYMENTS,
  E2E_PORT,
  E2E_RATES,
  OWNER,
} from "@/tests/e2e/fixtures";
import { startMocks } from "./lib/e2e-mocks";
import { assembleStandalone, STANDALONE_SERVER } from "./lib/standalone";

async function main(): Promise<void> {
  if (!assembleStandalone()) {
    console.error('No production build found. Run "npm run build" before the end-to-end tests.');
    process.exit(1);
  }

  const replSet = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: "wiredTiger",
      // Playwright signals its whole process group on shutdown; MongoDB gets its own group so that
      // only stop() below shuts it down. (If this script dies, MMS's watchdog still stops MongoDB.)
      spawn: process.platform === "win32" ? {} : { detached: true },
    },
  });
  const mongoUrl = replSet.getUri();
  const client = await new MongoClient(mongoUrl).connect();
  await runMigrations(client.db(E2E_DB_NAME));
  await seedContent(client.db(E2E_DB_NAME));
  // The owner account, as "npm run admin -- create" makes it: two-step sign-in is set up by the tests.
  await createOwner(client.db(E2E_DB_NAME), OWNER);
  await client.close();
  mkdirSync(path.dirname(E2E_MONGO_URL_FILE), { recursive: true });
  rmSync(E2E_BACKUP_DIR, { recursive: true, force: true });
  writeFileSync(E2E_MONGO_URL_FILE, mongoUrl);
  const mocks = await startMocks({
    port: E2E_MOCK_PORT,
    apiKey: E2E_NOWPAYMENTS.apiKey,
    ipnSecret: E2E_NOWPAYMENTS.ipnSecret,
    rates: E2E_RATES,
  });

  const server = spawn(process.execPath, [STANDALONE_SERVER], {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(E2E_PORT),
      HOSTNAME: "127.0.0.1",
      MONGO_URL: mongoUrl,
      DB_NAME: E2E_DB_NAME,
      SITE_URL: E2E_BASE_URL,
      HEALTH_TOKEN: E2E_HEALTH_TOKEN,
      DATA_ENCRYPTION_KEYS: E2E_ENCRYPTION_KEYS,
      CLIENT_IP_SOURCE: "socket",
      // Emails are written to the log, so replies and alerts can be tested without a mail server.
      EMAIL_DELIVERY: "log",
      NOTIFY_EMAIL_TO: OWNER.email,
      BACKUP_KEY: E2E_BACKUP_KEY,
      BACKUP_DIR: E2E_BACKUP_DIR,
      // Crypto payments and exchange rates from the local mocks.
      NOWPAYMENTS_API_KEY: E2E_NOWPAYMENTS.apiKey,
      NOWPAYMENTS_IPN_SECRET: E2E_NOWPAYMENTS.ipnSecret,
      NOWPAYMENTS_API_URL: `${E2E_MOCK_URL}/v1`,
      TCMB_RATES_URL: `${E2E_MOCK_URL}/kurlar`,
      GITHUB_API_URL: `${E2E_MOCK_URL}/github`,
      LOG_LEVEL: process.env.LOG_LEVEL ?? "warn",
    },
  });

  let stopping = false;
  const stop = async (code: number): Promise<void> => {
    if (stopping) return;
    stopping = true;
    server.kill();
    mocks.close();
    await replSet.stop();
    process.exit(code);
  };
  server.on("exit", (code) => void stop(code ?? 1));
  process.on("SIGINT", () => void stop(0));
  process.on("SIGTERM", () => void stop(0));
}

void main();
