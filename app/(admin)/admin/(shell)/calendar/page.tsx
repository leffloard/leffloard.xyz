import Link from "next/link";
import { BlockForm, DeleteBlockButton, RequestButtons } from "@/components/admin/calendar/controls";
import {
  WeekGrid,
  type AllDayItem,
  type GridDay,
  type GridEvent,
} from "@/components/admin/calendar/week-grid";
import { PageHeader } from "@/components/admin/shell";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { intervalsOn, minutesOf } from "@/lib/booking/availability";
import { ADMIN_TIME_ZONE, formatDateTime } from "@/lib/format";
import { addDays, isCalendarDate, todayIn, wallDateTime, zonedInstant } from "@/lib/intake/time";
import { formatDay, formatWeekday, weekdayIndex, weekStart } from "@/lib/work/dates";
import { OPEN_STAGES } from "@/lib/work/options";
import { requireAdmin } from "@/server/auth/dal";
import { BLOCK_LABELS, blocksBetween } from "@/server/calendar/blocks";
import { meetingsBetween } from "@/server/calendar/meetings";
import { getCalendarSettings } from "@/server/calendar/settings";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { projects, tasks } from "@/server/work/collections";

export const metadata = { title: "Calendar" };

const DAY_MINUTES = 24 * 60;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Minutes since midnight on `date` (owner's zone) of an instant, clamped to that day.
function minuteOn(at: Date, date: string, zone: string): number {
  const wall = wallDateTime(at, zone);
  if (wall.date < date) return 0;
  if (wall.date > date) return DAY_MINUTES;
  return Number(wall.time.slice(0, 2)) * 60 + Number(wall.time.slice(3));
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const raw = await searchParams;
  const at = now();
  const zone = ADMIN_TIME_ZONE;
  const today = todayIn(zone, at);
  const asked = first(raw.week);
  const week = weekStart(asked && isCalendarDate(asked) ? asked : today);
  const thisWeek = weekStart(today);
  const days = Array.from({ length: 7 }, (_, index) => addDays(week, index));
  const from = zonedInstant(week, "00:00", zone)!;
  const to = zonedInstant(addDays(week, 7), "00:00", zone)!;
  const db = await getDb();
  const [settings, meetingDocs, blockDocs, taskDocs, projectDocs, requests] = await Promise.all([
    getCalendarSettings(db),
    meetingsBetween(db, from, to),
    blocksBetween(db, from, to),
    tasks(db)
      .find(
        { status: { $ne: "done" }, due: { $gte: week, $lte: addDays(week, 6) } },
        { projection: { title: 1, due: 1 } },
      )
      .toArray(),
    projects(db)
      .find({ stage: { $in: OPEN_STAGES } }, { projection: { ref: 1, title: 1, dueDate: 1, milestones: 1 } })
      .toArray(),
    meetingsBetween(db, at, new Date(at.getTime() + 365 * 86_400_000), ["requested"]),
  ]);

  const gridDays: GridDay[] = days.map((date) => {
    const events: GridEvent[] = [
      ...meetingDocs
        .filter(
          (meeting) =>
            minuteOn(meeting.startsAt, date, zone) < DAY_MINUTES && minuteOn(meeting.endsAt, date, zone) > 0,
        )
        .map((meeting) => ({
          id: meeting._id.toHexString(),
          kind: "meeting" as const,
          title: `${meeting.title}: ${meeting.name}`,
          detail: meeting.status === "requested" ? "request" : "",
          startMinute: minuteOn(meeting.startsAt, date, zone),
          endMinute: minuteOn(meeting.endsAt, date, zone),
          tone: meeting.status === "requested" ? ("requested" as const) : ("confirmed" as const),
          href: `/admin/calendar/meetings/${meeting._id.toHexString()}`,
        })),
      ...blockDocs
        .filter(
          (block) =>
            minuteOn(block.startsAt, date, zone) < DAY_MINUTES && minuteOn(block.endsAt, date, zone) > 0,
        )
        .map((block) => ({
          id: `${block._id.toHexString()}-${date}`,
          kind: "block" as const,
          title: block.title || BLOCK_LABELS[block.kind],
          detail: "",
          startMinute: minuteOn(block.startsAt, date, zone),
          endMinute: minuteOn(block.endsAt, date, zone),
          tone: "block" as const,
          href: null,
        })),
    ];
    const allDay: AllDayItem[] = [
      ...projectDocs
        .filter((project) => project.dueDate === date)
        .map((project) => ({
          label: `Due: ${project.title}`,
          href: `/admin/projects/${project._id.toHexString()}`,
          tone: "deadline" as const,
        })),
      ...projectDocs.flatMap((project) =>
        project.milestones
          .filter((milestone) => !milestone.done && milestone.dueDate === date)
          .map((milestone) => ({
            label: milestone.title,
            href: `/admin/projects/${project._id.toHexString()}`,
            tone: "milestone" as const,
          })),
      ),
      ...taskDocs
        .filter((task) => task.due === date)
        .map((task) => ({
          label: task.title,
          href: `/admin/tasks/${task._id.toHexString()}`,
          tone: "task" as const,
        })),
    ];
    const open =
      settings.timeZone === zone
        ? intervalsOn(settings, date, weekdayIndex(date)).map((interval) => ({
            startMinute: minutesOf(interval.start) ?? 0,
            endMinute: minutesOf(interval.end) ?? 0,
          }))
        : [];
    return {
      date,
      label: formatWeekday(date, today).split(" ").slice(0, 2).join(" "),
      isToday: date === today,
      events,
      allDay,
      open,
    };
  });

  const minutes = gridDays.flatMap((day) => [
    ...day.events.flatMap((event) => [event.startMinute, event.endMinute]),
    ...day.open.flatMap((range) => [range.startMinute, range.endMinute]),
  ]);
  const startHour = Math.min(8, ...minutes.map((minute) => Math.floor(minute / 60)));
  const endHour = Math.max(22, ...minutes.map((minute) => Math.ceil(minute / 60)));
  const nowMarker = days.includes(today) ? { date: today, minute: minuteOn(at, today, zone) } : null;
  const weekHref = (start: string) =>
    start === thisWeek ? "/admin/calendar" : `/admin/calendar?week=${start}`;

  return (
    <>
      <PageHeader
        title="Calendar"
        description={`Week of ${formatDay(week, today)} to ${formatDay(addDays(week, 6), today)}.`}
        action={
          <div className="flex flex-wrap gap-2">
            <nav aria-label="Weeks" className="flex gap-2">
              <Link href={weekHref(addDays(week, -7))} className={buttonClasses("secondary", "sm")}>
                ← Previous
              </Link>
              {week !== thisWeek ? (
                <Link href="/admin/calendar" className={buttonClasses("secondary", "sm")}>
                  This week
                </Link>
              ) : null}
              <Link href={weekHref(addDays(week, 7))} className={buttonClasses("secondary", "sm")}>
                Next →
              </Link>
            </nav>
            <Link href="/admin/calendar/new" className={buttonClasses("primary", "sm")}>
              New meeting
            </Link>
          </div>
        }
      />

      <nav aria-label="Calendar settings" className="mb-6 flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
        <Link href="/admin/calendar/availability" className="text-accent underline-offset-4 hover:underline">
          Hours, rules and the calendar feed
        </Link>
        <Link href="/admin/calendar/types" className="text-accent underline-offset-4 hover:underline">
          Booking types
        </Link>
        <Link href="/book" className="text-muted underline-offset-4 hover:text-ink hover:underline">
          Public booking page
        </Link>
      </nav>

      {requests.length ? (
        <Card className="mb-6">
          <CardHeader
            title="Waiting for your answer"
            description="Booked times held until you confirm or decline."
          />
          <ul className="divide-y divide-line">
            {requests.map((meeting) => (
              <li
                key={meeting._id.toHexString()}
                className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13px]"
              >
                <Link
                  href={`/admin/calendar/meetings/${meeting._id.toHexString()}`}
                  className="min-w-0 flex-1 hover:text-accent"
                >
                  <span className="font-medium">{meeting.name}</span>
                  <span className="text-muted">
                    {" "}
                    · {meeting.title} · {formatDateTime(meeting.startsAt)}
                  </span>
                </Link>
                <RequestButtons id={meeting._id.toHexString()} name={meeting.name} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="hidden lg:block">
        <WeekGrid days={gridDays} startHour={startHour} endHour={endHour} now={nowMarker} />
        <p className="mt-2 text-xs text-muted">
          Shaded: your bookable hours. Dashed: requests waiting for you. Striped: blocks. Times in {zone}.
        </p>
      </div>

      <ol className="grid gap-4 lg:hidden">
        {gridDays.map((day) => (
          <li key={day.date}>
            <h2 className={cn("mb-2 text-[13px] font-semibold", day.isToday && "text-accent")}>
              {formatWeekday(day.date, today)}
            </h2>
            {day.events.length || day.allDay.length ? (
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
                {day.allDay.map((item, index) => (
                  <li key={`all-${index}`} className="px-4 py-2 text-[13px]">
                    <Link href={item.href} className="hover:text-accent">
                      {item.label}
                    </Link>
                  </li>
                ))}
                {[...day.events]
                  .sort((a, b) => a.startMinute - b.startMinute)
                  .map((event) => (
                    <li key={event.id} className="flex items-baseline gap-3 px-4 py-2 text-[13px]">
                      <span className="w-24 shrink-0 font-mono text-xs text-muted">
                        {`${String(Math.floor(event.startMinute / 60)).padStart(2, "0")}:${String(event.startMinute % 60).padStart(2, "0")}`}
                      </span>
                      {event.href ? (
                        <Link href={event.href} className="min-w-0 flex-1 truncate hover:text-accent">
                          {event.title}
                        </Link>
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-muted">{event.title}</span>
                      )}
                      {event.tone === "requested" ? <Badge tone="warning">request</Badge> : null}
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">Nothing.</p>
            )}
          </li>
        ))}
      </ol>

      <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
        <BlockForm today={today} />
        <Card>
          <CardHeader title="Blocks this week" />
          <CardBody>
            {blockDocs.length ? (
              <ul className="grid gap-2 text-[13px]">
                {blockDocs.map((block) => (
                  <li key={block._id.toHexString()} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0">
                      <span className="font-medium">{block.title || BLOCK_LABELS[block.kind]}</span>
                      <span className="block text-xs text-muted">
                        {formatDateTime(block.startsAt)} – {formatDateTime(block.endsAt)}
                      </span>
                    </span>
                    <DeleteBlockButton id={block._id.toHexString()} title={block.title} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">No blocks this week.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
