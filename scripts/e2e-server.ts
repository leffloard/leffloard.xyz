// Web server for the Playwright tests: a throwaway MongoDB with the migrations applied, and the
// production build started from the standalone output exactly as the VDS will run it.
// Needs "npm run build" first.
import { spawn } from "node:child_process";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { runMigrations } from "@/server/db/migrate";
import { E2E_BASE_URL, E2E_DB_NAME, E2E_HEALTH_TOKEN, E2E_PORT } from "@/tests/e2e/fixtures";
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
  await client.close();

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
      LOG_LEVEL: process.env.LOG_LEVEL ?? "warn",
    },
  });

  let stopping = false;
  const stop = async (code: number): Promise<void> => {
    if (stopping) return;
    stopping = true;
    server.kill();
    await replSet.stop();
    process.exit(code);
  };
  server.on("exit", (code) => void stop(code ?? 1));
  process.on("SIGINT", () => void stop(0));
  process.on("SIGTERM", () => void stop(0));
}

void main();
