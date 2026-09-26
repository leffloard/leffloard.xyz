import "server-only";
import { Cron } from "croner";
import { runBackup } from "@/server/backup/service";
import { sendReminders } from "@/server/calendar/booking";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { log } from "@/server/log";
import { readChannels } from "@/server/notify/channels";
import { drainOutbox } from "@/server/notify/outbox";

// Background work inside the web server process, started once from instrumentation.ts. Every job is safe
// to run in two processes at once: the outbox claims each message, and runJob() (server/jobs/runner.ts)
// lets only one process run a job and records the result.

type Job = { name: string; pattern: string; run: () => Promise<void> };

const JOBS: Job[] = [
  {
    // Sends queued emails and Discord messages that could not go out right away, and retries failures.
    name: "outbox",
    pattern: "* * * * *",
    run: async () => {
      const summary = await drainOutbox(await getDb());
      if (summary.sent + summary.failed + summary.retrying > 0) log.info(summary, "outbox run");
    },
  },
  {
    // The nightly backup. Checked every 15 minutes, so a night the server was off is caught up.
    name: "backup",
    pattern: "*/15 * * * *",
    run: async () => {
      const outcome = await runBackup(await getDb(), { now: false });
      if (outcome?.ran) log.info({ ok: outcome.ok, result: outcome.message }, "nightly backup");
    },
  },
  {
    // Reminds guests of a meeting about a day before. Each reminder is claimed first, so it goes out once.
    name: "meeting-reminders",
    pattern: "*/10 * * * *",
    run: async () => {
      const sent = await sendReminders(await getDb(), {
        siteUrl: getEnv().SITE_URL,
        channels: readChannels(),
      });
      // The outbox job sends them within a minute.
      if (sent) log.info({ sent }, "meeting reminders queued");
    },
  },
];

const store = globalThis as typeof globalThis & { __leffloardJobs?: Cron[] };

export function startScheduler(): void {
  if (store.__leffloardJobs) return;
  store.__leffloardJobs = JOBS.map(
    (job) =>
      new Cron(
        job.pattern,
        {
          name: job.name,
          protect: true, // a slow run is not started again while it is still going
          unref: true, // never keeps a stopping process alive
          catch: (error: unknown) => log.error({ err: error, job: job.name }, "scheduled job failed"),
        },
        job.run,
      ),
  );
  log.info({ jobs: JOBS.map((job) => job.name) }, "scheduler started");
}

export function stopScheduler(): void {
  for (const job of store.__leffloardJobs ?? []) job.stop();
  delete store.__leffloardJobs;
}
