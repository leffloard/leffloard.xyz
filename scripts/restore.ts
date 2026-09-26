// Restores an encrypted backup. The file is checked completely before anything is written.
//
//   npm run restore -- <file> --check              restore drill: into a temporary database, compare, delete it
//   npm run restore -- <file> --into <database>    into an empty database, then apply the migrations
//   npm run restore -- <file> --into <database> --replace
//                                                  replace that database's contents (asks for confirmation)
//
// The key is BACKUP_KEY from the environment. See docs/DEPLOY.md, "Restoring".
import { randomBytes } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { MongoServerSelectionError } from "mongodb";
import { BackupError } from "@/server/backup/format";
import { openBackup, restoreInto, type RestoreReport } from "@/server/backup/restore";
import { closeClient, getClient } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { EnvError, getEnv } from "@/server/env";
import { ask } from "./lib/prompt";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function printReport(report: RestoreReport): void {
  for (const [name, count] of Object.entries(report.collections).sort()) console.log(`  ${name}: ${count}`);
  console.log(`${report.documents} documents restored.`);
  console.log(
    report.matches
      ? "Every collection matches the backup's own count."
      : "The counts do NOT match the backup's own count. Do not rely on this copy.",
  );
}

async function main(): Promise<number> {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", {
    info: () => {},
    error: console.error,
  });
  const file = process.argv[2];
  const check = process.argv.includes("--check");
  const into = option("--into");
  const replace = process.argv.includes("--replace");
  if (!file || file.startsWith("--") || (!check && !into)) {
    console.error("Usage: npm run restore -- <file> --check | --into <database> [--replace]");
    return 1;
  }
  if (into && !/^[A-Za-z0-9_-]{1,63}$/.test(into)) {
    console.error("The database name may only use letters, digits, '_' and '-'.");
    return 1;
  }

  try {
    const env = getEnv();
    if (!env.BACKUP_KEY) {
      console.error("Set BACKUP_KEY (the key the backup was made with) before restoring.");
      return 1;
    }
    const backup = await openBackup(file, env.BACKUP_KEY);
    try {
      console.log(
        `Backup of "${backup.header.database}" from ${backup.header.createdAt} (app ${backup.header.app}): check passed.`,
      );
      const client = await getClient();

      if (check) {
        const name = `restore_check_${randomBytes(4).toString("hex")}`;
        const target = client.db(name);
        try {
          const report = await restoreInto(target, backup, { replace: false });
          await runMigrations(target);
          printReport(report);
          console.log(`\nThe temporary database ${name} was deleted again.`);
          return report.matches ? 0 : 1;
        } finally {
          await target.dropDatabase();
        }
      }

      const target = client.db(into);
      if (replace) {
        const live = into === env.DB_NAME ? " (this is the database the site uses)" : "";
        const answer = await ask(
          `Replace everything in "${into}"${live}? Type the database name to confirm: `,
        );
        if (answer.trim() !== into) {
          console.log("Nothing was changed.");
          return 1;
        }
      }
      const report = await restoreInto(target, backup, { replace });
      const applied = await runMigrations(target);
      printReport(report);
      console.log(applied.length ? `Migrations applied: ${applied.join(", ")}` : "Migrations: up to date.");
      return report.matches ? 0 : 1;
    } finally {
      await backup.close();
    }
  } catch (error) {
    if (error instanceof EnvError || error instanceof BackupError) {
      console.error(error.message);
      return 1;
    }
    if (error instanceof MongoServerSelectionError) {
      console.error("Could not reach MongoDB. Check MONGO_URL and, for Atlas, the Network Access list.");
      return 1;
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(`No such file: ${file}`);
      return 1;
    }
    console.error("The restore failed:", error);
    return 1;
  } finally {
    await closeClient();
  }
}

void main().then((code) => process.exit(code));
