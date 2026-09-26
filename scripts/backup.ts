// Makes an encrypted backup of the database now, into BACKUP_DIR (the server also makes one every night).
//
//   npm run backup
//
// The deploy script runs this before applying migrations.
import { loadEnvConfig } from "@next/env";
import { MongoServerSelectionError } from "mongodb";
import { formatBytes } from "@/lib/format";
import { createBackup } from "@/server/backup/backup";
import { backupConfig } from "@/server/backup/service";
import { closeClient, getDb } from "@/server/db/client";
import { EnvError, getEnv } from "@/server/env";

async function main(): Promise<number> {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", {
    info: () => {},
    error: console.error,
  });
  try {
    const config = backupConfig(getEnv());
    if (!config) {
      console.error(
        "Backups are not set up: set BACKUP_KEY and BACKUP_DIR (see .env.example). Keep a copy of the key in your " +
          "password manager: without it no backup can be read.",
      );
      return 1;
    }
    const result = await createBackup(await getDb(), config);
    console.log(`Backup written: ${result.file}`);
    console.log(
      `${result.documents} documents, ${formatBytes(result.bytes)}; keeping the newest ${config.keep}.`,
    );
    return 0;
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(error.message);
      return 1;
    }
    if (error instanceof MongoServerSelectionError) {
      console.error("Could not reach MongoDB. Check MONGO_URL and, for Atlas, the Network Access list.");
      return 1;
    }
    console.error("The backup failed:", error);
    return 1;
  } finally {
    await closeClient();
  }
}

void main().then((code) => process.exit(code));
