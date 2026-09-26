// Applies pending database migrations to the database in MONGO_URL / DB_NAME.
//
//   npm run migrate              apply everything that is pending
//   npm run migrate -- --status  list pending migrations without applying them
//
// Exit codes: 0 done, 1 failed, 2 another process holds the migration lock (retry later).
import { loadEnvConfig } from "@next/env";
import { MongoServerSelectionError } from "mongodb";
import { seedContent } from "@/server/content/seed";
import { closeClient, getDb } from "@/server/db/client";
import { MigrationLockedError, pendingMigrations, runMigrations } from "@/server/db/migrate";
import { mongoHosts } from "@/server/db/url";
import { EnvError, getEnv } from "@/server/env";

async function main(): Promise<number> {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", {
    info: () => {},
    error: console.error,
  });
  const statusOnly = process.argv.includes("--status");

  try {
    const env = getEnv();
    const db = await getDb();
    const target = `${mongoHosts(env.MONGO_URL)} / ${env.DB_NAME}`;

    if (statusOnly) {
      const pending = await pendingMigrations(db);
      console.log(
        pending.length
          ? `Pending on ${target}:\n${pending.map((m) => `  ${m.id} ${m.name}`).join("\n")}`
          : `No pending migrations on ${target}.`,
      );
      return 0;
    }

    const applied = await runMigrations(db);
    console.log(
      applied.length ? `Applied on ${target}: ${applied.join(", ")}` : `Nothing to apply on ${target}.`,
    );
    // A database without the site's content gets it from content/ (once; never again after that).
    if (await seedContent(db)) console.log("Filled the site's content from content/.");
    return 0;
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(error.message);
      return 1;
    }
    if (error instanceof MigrationLockedError) {
      console.error(error.message);
      return 2;
    }
    if (error instanceof MongoServerSelectionError) {
      console.error(
        "Could not reach MongoDB. Check MONGO_URL, your internet connection and, for Atlas, " +
          "that this machine's IP address is allowed under Network Access.",
      );
      return 1;
    }
    console.error("Migration failed:", error);
    return 1;
  } finally {
    await closeClient();
  }
}

void main().then((code) => process.exit(code));
