import Link from "next/link";
import { cn } from "@/components/ui/cn";

// The week as a time grid (a server component: links only). Events are placed by their minutes since
// midnight in the owner's time zone; events that overlap share the column side by side.

export type GridEvent = {
  id: string;
  kind: "meeting" | "block";
  title: string;
  detail: string;
  startMinute: number;
  endMinute: number;
  tone: "confirmed" | "requested" | "block";
  href: string | null;
};

export type AllDayItem = { label: string; href: string; tone: "task" | "deadline" | "milestone" };

export type GridDay = {
  date: string;
  label: string; // "Mon 28"
  isToday: boolean;
  events: GridEvent[];
  allDay: AllDayItem[];
  open: { startMinute: number; endMinute: number }[]; // bookable hours, shaded
};

const HOUR_PX = 44;

// Side-by-side columns for overlapping events: each event gets a lane and the lane count of its cluster.
function lanes(events: GridEvent[]): Map<string, { lane: number; of: number }> {
  const sorted = [...events].sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);
  const placed = new Map<string, { lane: number; of: number }>();
  let cluster: GridEvent[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];
  const close = () => {
    const count = laneEnds.length;
    for (const event of cluster) placed.get(event.id)!.of = count;
    cluster = [];
    laneEnds = [];
  };
  for (const event of sorted) {
    if (event.startMinute >= clusterEnd && cluster.length) close();
    let lane = laneEnds.findIndex((end) => end <= event.startMinute);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(event.endMinute);
    } else {
      laneEnds[lane] = event.endMinute;
    }
    placed.set(event.id, { lane, of: 1 });
    cluster.push(event);
    clusterEnd = Math.max(clusterEnd, event.endMinute);
  }
  if (cluster.length) close();
  return placed;
}

const TONES: Record<GridEvent["tone"], string> = {
  confirmed: "border-accent/50 bg-accent/15 text-ink hover:bg-accent/25",
  requested: "border-dashed border-warning/70 bg-warning/10 text-ink hover:bg-warning/20",
  block:
    "border-line-strong bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgb(255_255_255/0.05)_6px_12px)] text-muted",
};

const ALL_DAY_TONES: Record<AllDayItem["tone"], string> = {
  task: "border-line-strong text-ink/85",
  deadline: "border-danger/40 text-danger",
  milestone: "border-accent/40 text-accent",
};

function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export function WeekGrid({
  days,
  startHour,
  endHour,
  now,
}: {
  days: GridDay[];
  startHour: number;
  endHour: number;
  now: { date: string; minute: number } | null;
}) {
  const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
  const height = (endHour - startHour) * HOUR_PX;
  const top = (minute: number) => ((minute - startHour * 60) / 60) * HOUR_PX;
  const hasAllDay = days.some((day) => day.allDay.length);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="grid grid-cols-[52px_repeat(7,minmax(0,1fr))] border-b border-line">
        <span />
        {days.map((day) => (
          <div
            key={day.date}
            className={cn(
              "border-l border-line px-2 py-2 text-center text-xs",
              day.isToday ? "font-semibold text-accent" : "text-muted",
            )}
          >
            {day.label}
          </div>
        ))}
      </div>
      {hasAllDay ? (
        <div className="grid grid-cols-[52px_repeat(7,minmax(0,1fr))] border-b border-line">
          <span className="px-1 py-1.5 text-right text-[10px] text-muted">all day</span>
          {days.map((day) => (
            <ul key={day.date} className="grid content-start gap-1 border-l border-line p-1">
              {day.allDay.map((item, index) => (
                <li key={index}>
                  <Link
                    href={item.href}
                    title={item.label}
                    className={cn(
                      "block truncate rounded border px-1.5 py-0.5 text-[11px] hover:bg-white/[0.05]",
                      ALL_DAY_TONES[item.tone],
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-[52px_repeat(7,minmax(0,1fr))]">
        <div className="relative" style={{ height }}>
          {hours.map((hour) => (
            <span
              key={hour}
              className="absolute right-2 -translate-y-1/2 font-mono text-[10px] text-muted"
              style={{ top: top(hour * 60) }}
            >
              {hour > startHour ? clock(hour * 60) : ""}
            </span>
          ))}
        </div>
        {days.map((day) => {
          const placement = lanes(day.events);
          return (
            <div key={day.date} className="relative border-l border-line" style={{ height }}>
              {day.open.map((range, index) => (
                <span
                  key={index}
                  aria-hidden
                  className="absolute inset-x-0 bg-success/[0.05]"
                  style={{
                    top: top(range.startMinute),
                    height: top(range.endMinute) - top(range.startMinute),
                  }}
                />
              ))}
              {hours.map((hour) => (
                <span
                  key={hour}
                  aria-hidden
                  className="absolute inset-x-0 border-t border-line/60"
                  style={{ top: top(hour * 60) }}
                />
              ))}
              {now?.date === day.date ? (
                <span
                  aria-hidden
                  className="absolute inset-x-0 z-20 border-t-2 border-danger"
                  style={{ top: top(now.minute) }}
                />
              ) : null}
              {day.events.map((event) => {
                const { lane, of } = placement.get(event.id) ?? { lane: 0, of: 1 };
                const start = Math.max(event.startMinute, startHour * 60);
                const end = Math.min(event.endMinute, endHour * 60);
                const style = {
                  top: top(start) + 1,
                  height: Math.max(top(end) - top(start) - 2, 18),
                  left: `calc(${(lane / of) * 100}% + 2px)`,
                  width: `calc(${100 / of}% - 4px)`,
                };
                const body = (
                  <>
                    <span className="block truncate font-medium">{event.title}</span>
                    <span className="block truncate text-[10px] text-muted">
                      {clock(event.startMinute)}–{clock(event.endMinute)} {event.detail}
                    </span>
                  </>
                );
                const className = cn(
                  "absolute z-10 overflow-hidden rounded-md border px-1.5 py-1 text-[11px] leading-tight transition-colors",
                  TONES[event.tone],
                );
                return event.href ? (
                  <Link key={event.id} href={event.href} className={className} style={style}>
                    {body}
                  </Link>
                ) : (
                  <span key={event.id} className={className} style={style}>
                    {body}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
