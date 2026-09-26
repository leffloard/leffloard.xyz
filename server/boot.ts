import "server-only";
import { formatProblems, readEnv } from "@/server/env";
import { log } from "@/server/log";

// Runs once when the server starts. A broken configuration stops the start with a readable list
// instead of failing later with a stack trace on the first request.
export function boot(): void {
  const report = readEnv();
  for (const warning of report.warnings) log.warn(warning);
  if (!report.ok) {
    console.error(
      `\n${formatProblems(report.problems)}\n\n` +
        "Fix them in .env.local (development) or the production env file, then start again.\n",
    );
    process.exit(1);
  }
  log.info({ db: report.env.DB_NAME, site: report.env.SITE_URL }, "leffloard.xyz is starting");
}
