import Link from "next/link";
import { PageHeader } from "@/components/admin/shell";
import { EntryForm, EntryRow } from "@/components/admin/time/entries";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatDuration, formatHours } from "@/lib/duration";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { addDays, isCalendarDate, todayIn } from "@/lib/intake/time";
import { formatDay, formatWeekday, weekStart } from "@/lib/work/dates";
import { requireAdmin } from "@/server/auth/dal";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { projectChoices } from "@/server/projects/store";
import { weekEntries } from "@/server/time/store";
import { toEntryRow } from "@/server/time/view";

export const metadata = { title: "Time" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function TimePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const raw = await searchParams;
  const today = todayIn(ADMIN_TIME_ZONE, now());
  const asked = first(raw.week);
  const week = weekStart(asked && isCalendarDate(asked) ? asked : today);
  const thisWeek = weekStart(today);
  const db = await getDb();
  const [entries, choices] = await Promise.all([weekEntries(db, week, ADMIN_TIME_ZONE), projectChoices(db)]);
  const projects = choices.map((choice) => ({
    id: choice.id,
    label: `${choice.ref} · ${choice.title}`,
    hourly: choice.hourly,
  }));
  const rows = entries.map((entry) => toEntryRow(entry, ADMIN_TIME_ZONE));
  const days = Array.from({ length: 7 }, (_, index) => addDays(week, index));

  const stopped = entries.filter((entry) => !entry.running);
  const total = stopped.reduce((sum, entry) => sum + entry.seconds, 0);
  const billable = stopped.filter((entry) => entry.billable).reduce((sum, entry) => sum + entry.seconds, 0);
  const byProject = new Map<string, { label: string; seconds: number }>();
  for (const entry of stopped) {
    const key = entry.project?.id ?? "none";
    const label = entry.project ? `${entry.project.ref} · ${entry.project.title}` : "No project";
    const current = byProject.get(key) ?? { label, seconds: 0 };
    current.seconds += entry.seconds;
    byProject.set(key, current);
  }
  const weekHref = (start: string) => (start === thisWeek ? "/admin/time" : `/admin/time?week=${start}`);

  return (
    <>
      <PageHeader
        title="Time"
        description={`Week of ${formatDay(week, today)} to ${formatDay(addDays(week, 6), today)}.`}
        action={
          <nav aria-label="Weeks" className="flex gap-2">
            <Link href={weekHref(addDays(week, -7))} className={buttonClasses("secondary", "sm")}>
              ← Previous
            </Link>
            {week !== thisWeek ? (
              <Link href="/admin/time" className={buttonClasses("secondary", "sm")}>
                This week
              </Link>
            ) : null}
            <Link href={weekHref(addDays(week, 7))} className={buttonClasses("secondary", "sm")}>
              Next →
            </Link>
          </nav>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid min-w-0 content-start gap-6">
          <Card>
            <CardHeader title="Add time" description="Worked without the timer? Add it here." />
            <CardBody>
              <EntryForm
                idPrefix="time-add"
                submitLabel="Add time"
                projects={projects}
                values={{
                  description: "",
                  projectId: "",
                  date: week === thisWeek ? today : week,
                  startTime: "",
                  duration: "",
                  billable: false,
                }}
              />
            </CardBody>
          </Card>

          {days.map((day) => {
            const dayRows = rows.filter((row) => row.values.date === day);
            const seconds = entries
              .filter((entry, index) => rows[index]!.values.date === day && !entry.running)
              .reduce((sum, entry) => sum + entry.seconds, 0);
            if (dayRows.length === 0 && day !== today) return null;
            return (
              <section key={day} aria-label={formatWeekday(day, today)}>
                <h2 className="mb-2 flex items-baseline justify-between text-[13px] font-semibold">
                  <span>
                    {formatWeekday(day, today)}
                    {day === today ? <span className="ml-2 font-normal text-accent">today</span> : null}
                  </span>
                  <span className="font-mono text-xs font-normal text-muted tabular-nums">
                    {formatDuration(seconds)}
                  </span>
                </h2>
                {dayRows.length ? (
                  <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
                    {dayRows.map((row) => (
                      <EntryRow key={row.id} entry={row} projects={projects} />
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-xl border border-dashed border-line-strong px-5 py-6 text-center text-[13px] text-muted">
                    Nothing yet today. The timer is in the sidebar.
                  </p>
                )}
              </section>
            );
          })}
          {rows.length === 0 && !days.includes(today) ? (
            <p className="rounded-xl border border-dashed border-line-strong px-5 py-8 text-center text-sm text-muted">
              No time tracked this week.
            </p>
          ) : null}
        </div>

        <div className="grid min-w-0 content-start gap-6">
          <Card>
            <CardHeader title="This week" />
            <CardBody className="grid gap-3 text-[13px]">
              <p>
                <span className="text-2xl font-semibold">{formatHours(total)}</span>
                <span className="text-muted"> tracked</span>
              </p>
              <p className="text-muted">{formatHours(billable)} billable</p>
              {byProject.size ? (
                <ul className="grid gap-1.5 border-t border-line pt-3">
                  {[...byProject.values()]
                    .sort((a, b) => b.seconds - a.seconds)
                    .map((project) => (
                      <li key={project.label} className="flex justify-between gap-3">
                        <span className="truncate">{project.label}</span>
                        <span className="font-mono tabular-nums">{formatDuration(project.seconds)}</span>
                      </li>
                    ))}
                </ul>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
