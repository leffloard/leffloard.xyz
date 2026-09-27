import "server-only";
import type { Db } from "mongodb";
import { site } from "@/content/site";
import { untrusted } from "@/lib/ai/untrusted";
import { ADMIN_TIME_ZONE, formatDate } from "@/lib/format";
import { addDays, todayIn, zonedInstant } from "@/lib/intake/time";
import { formatMoney, money, totalsByCurrency, type Money } from "@/lib/money";
import { daysBetween, weekStart } from "@/lib/work/dates";
import { PROJECT_STAGE_LABELS } from "@/lib/work/options";
import type { Prepared } from "@/server/ai/inbox";
import { businessContext, TASKS } from "@/server/ai/prompts";
import { invoices, payments, quotes } from "@/server/billing/collections";
import { meetings } from "@/server/calendar/settings";
import { now } from "@/server/clock";
import { loadContent } from "@/server/content/store";
import { getEnv } from "@/server/env";
import { inquiries } from "@/server/inquiries/store";
import { projects, tasks, timeEntries } from "@/server/work/collections";

// The weekly review: the last seven days and the next seven, as figures and short lists. No message text
// and no client names reach the model: projects appear by reference and title, invoices by number.

const hours = (seconds: number) => `${(seconds / 3600).toFixed(1)} h`;
const sums = (values: Money[]) =>
  totalsByCurrency(values)
    .map((value) => formatMoney(value))
    .join(" + ") || "nothing";

export async function weeklyFacts(db: Db, at: Date = now()): Promise<{ week: string; text: string }> {
  const today = todayIn(ADMIN_TIME_ZONE, at);
  const from = addDays(today, -7);
  const until = addDays(today, 7);
  const since = zonedInstant(from, "00:00", ADMIN_TIME_ZONE) ?? new Date(at.getTime() - 7 * 86_400_000);
  const ahead =
    zonedInstant(addDays(until, 1), "00:00", ADMIN_TIME_ZONE) ?? new Date(at.getTime() + 8 * 86_400_000);

  const [
    received,
    waiting,
    held,
    upcoming,
    done,
    overdue,
    dueSoon,
    open,
    time,
    issued,
    paid,
    late,
    quoteRows,
  ] = await Promise.all([
    inquiries(db)
      .find({ receivedAt: { $gte: since }, status: { $ne: "spam" } }, { projection: { kind: 1 } })
      .toArray(),
    inquiries(db)
      .find({ status: { $in: ["new", "open"] } }, { projection: { receivedAt: 1, status: 1 } })
      .toArray(),
    meetings(db).countDocuments({ status: "confirmed", startsAt: { $gte: since, $lt: at } }),
    meetings(db)
      .find(
        { status: { $in: ["confirmed", "requested"] }, startsAt: { $gte: at, $lt: ahead } },
        { projection: { title: 1, startsAt: 1, status: 1 } },
      )
      .sort({ startsAt: 1 })
      .limit(20)
      .toArray(),
    tasks(db)
      .find({ completedAt: { $gte: since } }, { projection: { title: 1 } })
      .limit(30)
      .toArray(),
    tasks(db)
      .find({ status: { $ne: "done" }, due: { $lt: today } }, { projection: { title: 1, due: 1 } })
      .sort({ due: 1 })
      .limit(20)
      .toArray(),
    tasks(db)
      .find(
        { status: { $ne: "done" }, due: { $gte: today, $lte: until } },
        { projection: { title: 1, due: 1 } },
      )
      .sort({ due: 1 })
      .limit(20)
      .toArray(),
    projects(db)
      .find(
        { stage: { $in: ["planned", "active", "review", "paused"] } },
        { projection: { ref: 1, title: 1, stage: 1, dueDate: 1 } },
      )
      .sort({ dueDate: 1 })
      .limit(20)
      .toArray(),
    timeEntries(db)
      .aggregate<{ _id: string | null; seconds: number }>([
        { $match: { startedAt: { $gte: since }, running: { $exists: false } } },
        { $lookup: { from: "projects", localField: "projectId", foreignField: "_id", as: "project" } },
        { $group: { _id: { $first: "$project.ref" }, seconds: { $sum: "$seconds" } } },
        { $sort: { seconds: -1 } },
      ])
      .toArray(),
    invoices(db)
      .find(
        { kind: "invoice", status: { $in: ["issued", "paid"] }, issueDate: { $gte: from } },
        { projection: { totals: 1, currency: 1 } },
      )
      .toArray(),
    payments(db)
      .find(
        { status: "confirmed", confirmedAt: { $gte: since } },
        { projection: { amountMinor: 1, currency: 1 } },
      )
      .toArray(),
    invoices(db)
      .find(
        { kind: "invoice", status: "issued", dueDate: { $lt: today } },
        { projection: { number: 1, dueDate: 1, totals: 1, paidMinor: 1, currency: 1 } },
      )
      .sort({ dueDate: 1 })
      .limit(20)
      .toArray(),
    quotes(db)
      .find(
        { $or: [{ sentAt: { $gte: since } }, { answeredAt: { $gte: since } }] },
        { projection: { status: 1, sentAt: 1, answeredAt: 1 } },
      )
      .toArray(),
  ]);

  const byKind = new Map<string, number>();
  for (const message of received) byKind.set(message.kind, (byKind.get(message.kind) ?? 0) + 1);
  const oldestWaiting = waiting.reduce<Date | null>(
    (oldest, message) => (!oldest || message.receivedAt < oldest ? message.receivedAt : oldest),
    null,
  );
  const list = (items: string[], none: string) =>
    items.length ? items.map((item) => `- ${item}`) : [`- ${none}`];
  const totalSeconds = time.reduce((sum, row) => sum + row.seconds, 0);

  const lines = [
    "Inbox:",
    `- Received: ${received.length}${byKind.size ? ` (${[...byKind].map(([kind, count]) => `${count} ${kind}`).join(", ")})` : ""}.`,
    `- Waiting for an answer: ${waiting.length}${oldestWaiting ? `, the oldest since ${formatDate(oldestWaiting)}` : ""}.`,
    "",
    `Meetings held: ${held}. Coming up:`,
    ...list(
      upcoming.map(
        (meeting) =>
          `${meeting.title}, ${formatDate(meeting.startsAt)}${meeting.status === "requested" ? " (waiting for approval)" : ""}`,
      ),
      "none",
    ),
    "",
    `Tasks finished (${done.length}):`,
    ...list(
      done.map((task) => task.title),
      "none",
    ),
    "Overdue tasks:",
    ...list(
      overdue.map((task) => `${task.title} (due ${task.due}, ${daysBetween(task.due!, today)} days ago)`),
      "none",
    ),
    "Due in the next seven days:",
    ...list(
      dueSoon.map((task) => `${task.title} (due ${task.due})`),
      "none",
    ),
    "",
    "Open projects:",
    ...list(
      open.map(
        (project) =>
          `${project.ref} "${project.title}": ${PROJECT_STAGE_LABELS[project.stage]}${project.dueDate ? `, due ${project.dueDate}` : ", no due date"}`,
      ),
      "none",
    ),
    `Time tracked: ${hours(totalSeconds)}${time.length ? ` (${time.map((row) => `${row._id ?? "no project"} ${hours(row.seconds)}`).join(", ")})` : ""}.`,
    "",
    "Money:",
    `- Invoiced: ${sums(issued.map((invoice) => money(invoice.totals.totalMinor, invoice.currency)))} (${issued.length} invoices).`,
    `- Received: ${sums(paid.map((payment) => money(payment.amountMinor, payment.currency)))}.`,
    "- Overdue invoices:",
    ...list(
      late.map(
        (invoice) =>
          `${invoice.number}: ${formatMoney(money(invoice.totals.totalMinor - invoice.paidMinor, invoice.currency))} unpaid, due ${invoice.dueDate}`,
      ),
      "none",
    ),
    `- Quotes: ${quoteRows.filter((quote) => quote.sentAt && quote.sentAt >= since).length} sent, ${quoteRows.filter((quote) => quote.status === "accepted" && quote.answeredAt && quote.answeredAt >= since).length} accepted, ${quoteRows.filter((quote) => quote.status === "declined" && quote.answeredAt && quote.answeredAt >= since).length} declined.`,
  ];
  // Titles can carry clients' words (a revision round's title, a project named after a message), so the
  // figures and lists go to the model as data.
  return {
    week: weekStart(today),
    text: [
      `Today is ${formatDate(at)}. The review covers ${from} to ${today}, and looks ahead to ${until}.`,
      "",
      untrusted("admin records", lines.join("\n")),
    ].join("\n"),
  };
}

export async function prepareWeeklyReview(db: Db, guidance: string): Promise<Prepared> {
  const [facts, content] = await Promise.all([weeklyFacts(db), loadContent(db, "published")]);
  return {
    ok: true,
    request: {
      feature: "weekly",
      target: { kind: "week", id: facts.week },
      system: { shared: businessContext(content, getEnv().SITE_URL), task: TASKS.weekly },
      prompt: guidance
        ? `${facts.text}\n\n${site.firstName}'s notes for this review (follow them): ${guidance}`
        : facts.text,
    },
  };
}
