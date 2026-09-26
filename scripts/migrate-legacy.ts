// Copies the v1 site's requests (the `requests` collection) into the new inbox. The v1 collection is only
// read. Safe to run again: requests that were copied before are skipped.
//
//   npm run migrate-legacy               dry run: what would be copied (the default, writes nothing)
//   npm run migrate-legacy -- --apply    copy what is missing
//   npm run migrate-legacy -- --verify   check that every v1 request has a matching copy
//
// Output never includes names, addresses or messages, only counts and v1 request ids.
import { loadEnvConfig } from "@next/env";
import { MongoServerSelectionError } from "mongodb";
import { audit } from "@/server/auth/audit";
import { closeClient, getDb } from "@/server/db/client";
import { pendingMigrations } from "@/server/db/migrate";
import { mongoHosts } from "@/server/db/url";
import { EnvError, getEnv } from "@/server/env";
import { migrateLegacy, verifyLegacy, type MigrationReport } from "@/server/inquiries/legacy-migration";

function counts(label: string, values: Record<string, number>): string {
  const entries = Object.entries(values);
  return entries.length
    ? `${label}: ${entries.map(([key, count]) => `${key} ${count}`).join(", ")}`
    : `${label}: none`;
}

function printReport(report: MigrationReport, applied: boolean): void {
  console.log(`v1 requests found:       ${report.total}`);
  console.log(`already in the inbox:    ${report.alreadyCopied}`);
  console.log(
    applied ? `copied now:              ${report.copied}` : `would be copied:         ${report.toCopy}`,
  );
  console.log(counts("by kind", report.byType));
  console.log(counts("by status", report.byStatus));
  if (report.problems.length) {
    console.log(`\n${report.problems.length} request(s) could not be read and were skipped:`);
    for (const problem of report.problems) console.log(`  ${problem.id}: ${problem.problem}`);
  }
}

async function main(): Promise<number> {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", {
    info: () => {},
    error: console.error,
  });
  const apply = process.argv.includes("--apply");
  const verify = process.argv.includes("--verify");
  try {
    const env = getEnv();
    const db = await getDb();
    console.log(`Database: ${mongoHosts(env.MONGO_URL)} / ${env.DB_NAME}\n`);
    if ((await pendingMigrations(db)).length) {
      console.error('Run "npm run migrate" first: the inbox indexes are not in place yet.');
      return 1;
    }

    if (verify) {
      const report = await verifyLegacy(db);
      console.log(`v1 requests: ${report.total}, matching copies: ${report.matched}`);
      if (report.missing.length) console.log(`missing: ${report.missing.join(", ")}`);
      for (const entry of report.different)
        console.log(`different: ${entry.id} (${entry.fields.join(", ")})`);
      const ok = report.missing.length === 0 && report.different.length === 0;
      console.log(
        ok
          ? "\nEverything is copied."
          : "\nSome requests are missing or differ. Run with --apply, then verify again.",
      );
      return ok ? 0 : 1;
    }

    const report = await migrateLegacy(db, { apply });
    printReport(report, apply);
    if (apply) {
      await audit(db, {
        action: "inbox.legacy.migrated",
        ip: "server console",
        userAgent: "npm run migrate-legacy",
        details: { copied: report.copied, total: report.total },
      });
      console.log("\nDone. Check it with: npm run migrate-legacy -- --verify");
    } else {
      console.log("\nDry run: nothing was written. Copy for real with: npm run migrate-legacy -- --apply");
    }
    return report.problems.length ? 1 : 0;
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(error.message);
      return 1;
    }
    if (error instanceof MongoServerSelectionError) {
      console.error("Could not reach MongoDB. Check MONGO_URL and, for Atlas, the Network Access list.");
      return 1;
    }
    console.error("The migration failed:", error);
    return 1;
  } finally {
    await closeClient();
  }
}

void main().then((code) => process.exit(code));
