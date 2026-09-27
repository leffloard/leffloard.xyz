import "server-only";
import type { Db } from "mongodb";
import { GOAL_LABELS, type Goal } from "@/lib/analytics/model";
import { ADMIN_TIME_ZONE, plural } from "@/lib/format";
import { addDays, todayIn, wallDateTime, zonedInstant } from "@/lib/intake/time";
import { formatMoney, money, type Currency } from "@/lib/money";
import { formatDay } from "@/lib/work/dates";
import { dayStats } from "@/server/analytics/stats";
import { listInvoices } from "@/server/billing/invoices";
import { countReview } from "@/server/billing/payments";
import { countRequests, upcomingMeetings } from "@/server/calendar/meetings";
import { now } from "@/server/clock";
import { countNew, latestInquiries } from "@/server/inquiries/store";
import { runJob, type JobOutcome } from "@/server/jobs/runner";
import type { Channels } from "@/server/notify/channels";
import { headerText } from "@/server/notify/escape";
import { enqueue } from "@/server/notify/outbox";
import { countUnread } from "@/server/notify/owner";
import { getNotificationSettings } from "@/server/notify/settings";
import type { EmailMessage } from "@/server/notify/templates";
import { listProjects } from "@/server/projects/store";
import { listTasks, taskCounts } from "@/server/tasks/store";

// The morning email: today's calls, what is due, messages waiting, money to collect and yesterday's visits.
// Sent once a day at the time set on the Notifications page (the "digest" job), or on demand.

export type Digest = { subject: string; text: string; quiet: boolean };

const MAX_LINES = 6;

function more(total: number, shown: number): string[] {
  return total > shown ? [`  … and ${total - shown} more`] : [];
}

export async function buildDigest(db: Db, { at, siteUrl }: { at: Date; siteUrl: string }): Promise<Digest> {
  const today = todayIn(ADMIN_TIME_ZONE, at);
  const yesterday = addDays(today, -1);
  const endOfToday = zonedInstant(addDays(today, 1), "00:00", ADMIN_TIME_ZONE) ?? at;
  const [meetings, requests, due, counts, newCount, inbox, open, review, projects, visits, unread] =
    await Promise.all([
      upcomingMeetings(db, at, 20),
      countRequests(db, at),
      listTasks(db, "today", today, { limit: MAX_LINES }),
      taskCounts(db, today),
      countNew(db),
      latestInquiries(db, MAX_LINES, at),
      listInvoices(db, { view: "open" }),
      countReview(db),
      listProjects(db, { view: "open" }),
      dayStats(db, [yesterday], today),
      countUnread(db),
    ]);

  const calls = meetings.filter((meeting) => meeting.startsAt < endOfToday && meeting.status !== "requested");
  const overdue = open.filter((invoice) => invoice.dueDate !== null && invoice.dueDate < today);
  const owed = new Map<Currency, number>();
  for (const invoice of overdue) {
    const left = invoice.totals.totalMinor - invoice.paidMinor - (invoice.creditedMinor ?? 0);
    if (left > 0) owed.set(invoice.currency, (owed.get(invoice.currency) ?? 0) + left);
  }
  const soon = projects.items.filter((project) => project.dueDate && project.dueDate <= addDays(today, 7));
  const fresh = inbox.filter((item) => item.status === "new");
  const traffic = visits.get(yesterday)!;
  const admin = `${siteUrl}/admin`;

  const sections: string[][] = [];
  sections.push([
    calls.length ? `Calls today (${calls.length})` : "No calls today.",
    ...calls.slice(0, MAX_LINES).map((meeting) => {
      const time = wallDateTime(meeting.startsAt, ADMIN_TIME_ZONE).time;
      return `  ${time}  ${meeting.title} with ${meeting.name}`;
    }),
    ...more(calls.length, MAX_LINES),
    ...(requests
      ? [`${plural(requests, "booking request")} waiting for your answer: ${admin}/calendar`]
      : []),
  ]);
  const dueCount = counts.today;
  sections.push([
    dueCount ? `Tasks due today or late (${dueCount})` : "No tasks due.",
    ...due.map(
      (task) =>
        `  ${task.due && task.due < today ? `[late since ${formatDay(task.due, today)}] ` : ""}${task.title}${task.project ? ` (${task.project.ref})` : ""}`,
    ),
    ...more(dueCount, due.length),
  ]);
  sections.push([
    newCount ? `New messages (${newCount})` : "No new messages.",
    ...fresh.map((item) => `  ${item.name}: ${item.subject}`),
    ...more(newCount, fresh.length),
  ]);
  const money_: string[] = [];
  if (overdue.length) {
    money_.push(
      `${plural(overdue.length, "overdue invoice")}: ${[...owed.entries()]
        .map(([currency, minor]) => formatMoney(money(minor, currency)))
        .join(", ")} to collect`,
    );
  }
  if (review) money_.push(`${plural(review, "payment")} to review: ${admin}/billing/payments`);
  if (money_.length) sections.push(["Money", ...money_.map((line) => `  ${line}`)]);
  if (soon.length) {
    sections.push([
      `Projects due within a week (${soon.length})`,
      ...soon
        .slice(0, MAX_LINES)
        .map((project) => `  ${project.ref} ${project.title}: due ${formatDay(project.dueDate!, today)}`),
      ...more(soon.length, MAX_LINES),
    ]);
  }
  const goals = traffic.goals
    .map((goal) => `${goal.count} × ${GOAL_LABELS[goal.key as Goal]?.toLowerCase() ?? goal.key}`)
    .join(", ");
  sections.push([
    `Yesterday on the site: ${plural(traffic.visitors, "visitor")}, ${plural(traffic.views, "page view")}${
      goals ? `; ${goals}` : ""
    }.`,
  ]);
  if (unread) sections.push([`${plural(unread, "unread notification")}: ${admin}/notifications`]);

  const summary = [
    calls.length ? plural(calls.length, "call") : null,
    dueCount ? plural(dueCount, "task") : null,
    newCount ? plural(newCount, "new message", "new messages") : null,
    overdue.length ? plural(overdue.length, "overdue invoice") : null,
  ].filter(Boolean);
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: ADMIN_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(at);
  const text = [
    `Your day, ${date}`,
    "",
    ...sections.flatMap((lines) => [...lines, ""]),
    `Open the admin: ${admin}`,
    `Change or stop this email: ${admin}/notifications`,
    "",
  ].join("\n");
  return {
    subject: headerText(`Your day: ${summary.length ? summary.join(", ") : "nothing waiting"}`),
    text,
    quiet: summary.length === 0 && requests === 0 && review === 0,
  };
}

export type DigestContext = { siteUrl: string; channels: Channels };

function digestEmail(digest: Digest, to: string): EmailMessage {
  return { to: [{ address: to }], subject: digest.subject, text: digest.text };
}

// Queues the digest for the owner; `key` makes the scheduled one go out once a day.
export async function queueDigest(
  db: Db,
  context: DigestContext,
  { at, key }: { at: Date; key: string },
): Promise<{ queued: boolean; digest: Digest }> {
  const digest = await buildDigest(db, { at, siteUrl: context.siteUrl });
  if (!context.channels.ownerEmail) return { queued: false, digest };
  const id = await enqueue(db, {
    channel: "email",
    payload: digestEmail(digest, context.channels.ownerEmail),
    dedupeKey: key,
    label: `Daily digest, ${todayIn(ADMIN_TIME_ZONE, at)}`,
  });
  return { queued: id !== null, digest };
}

// The "digest" job: once a day, from the chosen time on (so a morning the server was off is caught up
// later that day), when the digest is on and email alerts work.
export async function runDigestJob(
  db: Db,
  context: DigestContext,
  at: Date = now(),
): Promise<JobOutcome | null> {
  const settings = await getNotificationSettings(db);
  if (!settings.digestEnabled || !context.channels.ownerEmail) return null;
  const today = todayIn(ADMIN_TIME_ZONE, at);
  const due = zonedInstant(today, settings.digestTime, ADMIN_TIME_ZONE);
  if (!due || at < due) return null;
  return runJob(
    db,
    "digest",
    async () => {
      const { queued } = await queueDigest(db, context, { at, key: `digest:${today}` });
      return queued ? "queued" : "already sent today";
    },
    { periodKey: today, lockMs: 10 * 60_000 },
  );
}
