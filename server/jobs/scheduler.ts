import "server-only";
import { Cron } from "croner";
import { getDb } from "@/server/db/client";
import { log } from "@/server/log";
import { drainOutbox } from "@/server/notify/outbox";

// Background work inside the web server process, started once from instrumentation.ts. Jobs must be safe
// to run twice at the same moment (the outbox claims each message), because a second server process, or a
// restart during a run, can overlap with this one.

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
