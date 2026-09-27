import "server-only";
import { Cron } from "croner";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { todayIn } from "@/lib/intake/time";
import { purgeOrphanRuns } from "@/server/ai/ledger";
import { rollupDays } from "@/server/analytics/stats";
import { alertBackupFailed, runBackup } from "@/server/backup/service";
import { reconcileCryptoPayments } from "@/server/billing/ipn";
import { nowPaymentsConfig } from "@/server/billing/nowpayments";
import { runRecurringJob } from "@/server/billing/recurring";
import { runRemindersJob } from "@/server/billing/reminders";
import { sendReminders } from "@/server/calendar/booking";
import { now } from "@/server/clock";
import { publishDue } from "@/server/content/editor";
import { runGithubJob } from "@/server/content/github";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { runRatesJob } from "@/server/finance/rates";
import { runJob } from "@/server/jobs/runner";
import { log } from "@/server/log";
import { readChannels } from "@/server/notify/channels";
import { runDigestJob } from "@/server/notify/digest";
import { drainOutbox } from "@/server/notify/outbox";

// Background work inside the web server process, started once from instrumentation.ts. Every job is safe
// to run in two processes at once: the outbox claims each message, and runJob() (server/jobs/runner.ts)
// lets only one process run a job and records the result.

type Job = { name: string; pattern: string; run: () => Promise<void> };

const JOBS: Job[] = [
  {
    // AI drafts about an inbox message or meeting that was deleted by its own retention (spam after 30
    // days, say) go soon after it (server/ai/ledger.ts).
    name: "ai-cleanup",
    pattern: "35 * * * *",
    run: async () => {
      const removed = await purgeOrphanRuns(await getDb());
      if (removed) log.info({ removed }, "AI drafts about deleted items removed");
    },
  },
  {
    // Sums up yesterday's visits for the Analytics page, soon after midnight (server/analytics/stats.ts).
    name: "analytics",
    pattern: "5,35 * * * *",
    run: async () => {
      const db = await getDb();
      const at = now();
      const outcome = await runJob(
        db,
        "analytics",
        async () => `${await rollupDays(db, at)} days summed up`,
        { periodKey: todayIn(ADMIN_TIME_ZONE, at), lockMs: 10 * 60_000 },
      );
      if (outcome.ran) log.info({ ok: outcome.ok, result: outcome.message }, "visitor statistics");
    },
  },
  {
    // The owner's morning email, at the time set on the Notifications page (server/notify/digest.ts). Checked
    // every minute, so any time of day works (the check is one read until the time comes).
    name: "digest",
    pattern: "* * * * *",
    run: async () => {
      const outcome = await runDigestJob(await getDb(), {
        siteUrl: getEnv().SITE_URL,
        channels: readChannels(),
      });
      if (outcome?.ran) log.info({ ok: outcome.ok, result: outcome.message }, "daily digest");
    },
  },
  {
    // Publishes content the owner scheduled (server/content/editor.ts).
    name: "content-publish",
    pattern: "* * * * *",
    run: async () => {
      const result = await publishDue(await getDb(), {
        siteUrl: getEnv().SITE_URL,
        channels: readChannels(),
      });
      if (result.published + result.failed > 0) log.info(result, "scheduled content");
    },
  },
  {
    // The owner's public GitHub repositories for the work page, every six hours (server/content/github.ts).
    name: "github-sync",
    pattern: "*/30 * * * *",
    run: async () => {
      const env = getEnv();
      const outcome = await runGithubJob(await getDb(), {
        apiUrl: env.GITHUB_API_URL,
        token: env.GITHUB_TOKEN,
      });
      if (outcome.ran) log.info({ ok: outcome.ok, result: outcome.message }, "github sync");
    },
  },
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
      const db = await getDb();
      const outcome = await runBackup(db, { now: false });
      if (!outcome?.ran) return;
      log.info({ ok: outcome.ok, result: outcome.message }, "nightly backup");
      if (!outcome.ok) await alertBackupFailed(db, outcome.message, readChannels(), now());
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
  {
    // TCMB's exchange rates for the finance reports: each morning, and after the 15:30 bulletin.
    name: "fx-rates",
    pattern: "*/30 * * * *",
    run: async () => {
      const outcome = await runRatesJob(await getDb());
      if (outcome.ran) log.info({ ok: outcome.ok, result: outcome.message }, "exchange rates");
    },
  },
  {
    // Recurring invoices (care plans), issued and emailed during the day.
    name: "recurring-invoices",
    pattern: "*/15 * * * *",
    run: async () => {
      const outcome = await runRecurringJob(await getDb(), {
        siteUrl: getEnv().SITE_URL,
        channels: readChannels(),
      });
      if (outcome?.ran && outcome.message !== "0 issued") {
        log.info({ ok: outcome.ok, result: outcome.message }, "recurring invoices");
      }
    },
  },
  {
    // Crypto checkouts still pending are read again from NOWPayments, in case a callback was lost.
    name: "payments-check",
    pattern: "*/30 * * * *",
    run: async () => {
      const config = nowPaymentsConfig();
      if (!config) return;
      const db = await getDb();
      const outcome = await runJob(
        db,
        "payments-check",
        async () => {
          const result = await reconcileCryptoPayments(db, config, {
            siteUrl: getEnv().SITE_URL,
            channels: readChannels(),
          });
          return `${result.checked} checked, ${result.settled} settled`;
        },
        { lockMs: 10 * 60_000, retryAfterFailureMs: 30 * 60_000 },
      );
      if (outcome.ran && !outcome.message.startsWith("0 checked")) {
        log.info({ ok: outcome.ok, result: outcome.message }, "crypto payments checked");
      }
    },
  },
  {
    // Reminders of overdue invoices, once a day.
    name: "invoice-reminders",
    pattern: "*/30 * * * *",
    run: async () => {
      const outcome = await runRemindersJob(await getDb(), {
        siteUrl: getEnv().SITE_URL,
        channels: readChannels(),
      });
      if (outcome.ran) log.info({ ok: outcome.ok, result: outcome.message }, "invoice reminders");
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
