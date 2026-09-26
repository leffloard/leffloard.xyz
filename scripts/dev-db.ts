// Local MongoDB for development: a one-member replica set (transactions need one), data kept in
// .data/dev-db between runs. Development never touches the production Atlas database.
//
//   npm run dev:db      then, in a second terminal:   npm run dev
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { runMigrations } from "@/server/db/migrate";

const PORT = Number(process.env.DEV_DB_PORT ?? 27027);
const DATA_DIR = path.resolve(".data", "dev-db");
const ENV_FILE = path.resolve(".env.local");
const MONGO_URL = `mongodb://127.0.0.1:${PORT}/?replicaSet=rs0`;

// A development-only key. Production has its own, kept outside the repository.
function newEncryptionKey(): string {
  return `1:${randomBytes(32).toString("base64")}`;
}

function ensureEnvFile(): void {
  if (!existsSync(ENV_FILE)) {
    writeFileSync(
      ENV_FILE,
      [
        "# Local development settings (never committed). See .env.example for every option.",
        `MONGO_URL=${MONGO_URL}`,
        "DB_NAME=leffloard",
        "SITE_URL=http://localhost:3000",
        `DATA_ENCRYPTION_KEYS=${newEncryptionKey()}`,
        "# Emails (alerts, replies from the inbox) are printed in the terminal instead of being sent.",
        "# To send real ones, set the SMTP_* variables from .env.example and remove this line.",
        "EMAIL_DELIVERY=log",
        "",
      ].join("\n"),
    );
    console.log("Created .env.local with the local database address.");
    return;
  }
  const content = readFileSync(ENV_FILE, "utf8");
  if (!/^DATA_ENCRYPTION_KEYS=\S/m.test(content)) {
    appendFileSync(
      ENV_FILE,
      `${content.endsWith("\n") ? "" : "\n"}DATA_ENCRYPTION_KEYS=${newEncryptionKey()}\n`,
    );
    console.log("Added a development DATA_ENCRYPTION_KEYS to .env.local.");
  }
  const current = /^MONGO_URL=(.*)$/m.exec(content)?.[1]?.trim();
  if (current !== MONGO_URL) {
    console.log(
      `Note: .env.local points MONGO_URL somewhere else. For the local database use:\n  MONGO_URL=${MONGO_URL}`,
    );
  }
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });
  const dbName = process.env.DB_NAME?.trim() || "leffloard";
  mkdirSync(DATA_DIR, { recursive: true });

  console.log("Starting the local MongoDB (the first start downloads it, about 100 MB)...");
  let replSet: MongoMemoryReplSet;
  try {
    replSet = await MongoMemoryReplSet.create({
      replSet: { name: "rs0", count: 1, storageEngine: "wiredTiger" },
      instanceOpts: [{ port: PORT, dbPath: DATA_DIR }],
    });
  } catch (error) {
    console.error(
      `Could not start MongoDB on port ${PORT}. Is "npm run dev:db" already running in another terminal?\n` +
        `Another port: set DEV_DB_PORT (and the port in MONGO_URL).\n\n${String(error)}`,
    );
    process.exit(1);
  }

  const client = await new MongoClient(MONGO_URL).connect();
  try {
    const applied = await runMigrations(client.db(dbName));
    console.log(applied.length ? `Applied migrations: ${applied.join(", ")}` : "Migrations are up to date.");
  } finally {
    await client.close();
  }

  ensureEnvFile();
  console.log(`\nLocal MongoDB is running at ${MONGO_URL} (database "${dbName}").`);
  console.log('Start the site with "npm run dev" in another terminal. Stop this one with Ctrl+C.');
  console.log('No admin account yet? Run "npm run admin -- create" in another terminal.\n');

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await replSet.stop({ doCleanup: true, force: false });
    console.log("Local MongoDB stopped. The data stays in .data/dev-db.");
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}

void main();
