import { invalid, type Checked } from "@/lib/intake/text";
import { isCalendarDate } from "@/lib/intake/time";

// When the owner takes calls: weekly hours in the owner's time zone, dates with other hours (or none),
// and the rules around them. Times are wall-clock "HH:MM" on a 15-minute grid, so every meeting covers
// whole 15-minute cells (see slots.ts); "24:00" ends an interval at midnight.

export type Interval = { start: string; end: string };

export type DateOverride = { date: string; intervals: Interval[] }; // no intervals: closed that day

export type Availability = {
  timeZone: string;
  weekly: Interval[][]; // seven days, Monday first
  overrides: DateOverride[];
  bufferMinutes: number; // the gap kept after every meeting
  minNoticeMinutes: number; // how soon a call can be booked
  horizonDays: number; // how far ahead
  dailyCap: number; // meetings per day at most; 0 means no limit
  stepMinutes: number; // start times every 15, 30 or 60 minutes
};

export const CELL_MINUTES = 15;
export const DURATIONS = [15, 30, 45, 60, 90, 120] as const;
export const BUFFERS = [0, 15, 30] as const;
export const STEPS = [15, 30, 60] as const;
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const MAX_INTERVALS_PER_DAY = 4;
export const MAX_OVERRIDES = 100;

// A high-school schedule: after school on weekdays, a longer Saturday, Sundays off.
export const DEFAULT_AVAILABILITY: Availability = {
  timeZone: "Europe/Istanbul",
  weekly: [
    [{ start: "17:00", end: "21:00" }],
    [{ start: "17:00", end: "21:00" }],
    [{ start: "17:00", end: "21:00" }],
    [{ start: "17:00", end: "21:00" }],
    [{ start: "17:00", end: "21:00" }],
    [{ start: "11:00", end: "18:00" }],
    [],
  ],
  overrides: [],
  bufferMinutes: 15,
  minNoticeMinutes: 12 * 60,
  horizonDays: 30,
  dailyCap: 3,
  stepMinutes: 30,
};

const TIME = /^(?:([01]\d|2[0-3]):([0-5]\d)|24:00)$/;

// Minutes since midnight, or null for a time off the 15-minute grid.
export function minutesOf(time: string): number | null {
  const match = TIME.exec(time);
  if (!match) return null;
  const minutes = time === "24:00" ? 24 * 60 : Number(match[1]) * 60 + Number(match[2]);
  return minutes % CELL_MINUTES === 0 ? minutes : null;
}

export function timeOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

// A day's intervals: each on the grid, starting before it ends, sorted and not overlapping.
export function checkIntervals(intervals: Interval[]): Checked<Interval[]> {
  if (intervals.length > MAX_INTERVALS_PER_DAY)
    return invalid(`Up to ${MAX_INTERVALS_PER_DAY} ranges a day.`);
  const ranges: [number, number][] = [];
  for (const interval of intervals) {
    const start = minutesOf(interval.start);
    const end = minutesOf(interval.end);
    if (start === null || end === null) return invalid("Use times on the quarter hour, like 09:00 or 17:45.");
    if (start === 24 * 60 || end <= start) return invalid("Each range has to end after it starts.");
    ranges.push([start, end]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  for (let index = 1; index < ranges.length; index++) {
    if (ranges[index]![0] < ranges[index - 1]![1]) return invalid("Ranges on the same day overlap.");
  }
  return { ok: true, value: ranges.map(([start, end]) => ({ start: timeOf(start), end: timeOf(end) })) };
}

export function checkOverrides(overrides: DateOverride[]): Checked<DateOverride[]> {
  if (overrides.length > MAX_OVERRIDES) return invalid(`Up to ${MAX_OVERRIDES} special dates.`);
  const seen = new Set<string>();
  const checked: DateOverride[] = [];
  for (const override of overrides) {
    if (!isCalendarDate(override.date)) return invalid("Choose a valid date.");
    if (seen.has(override.date)) return invalid(`${override.date} is listed twice.`);
    seen.add(override.date);
    const intervals = checkIntervals(override.intervals);
    if (!intervals.ok) return invalid(`${override.date}: ${intervals.message}`);
    checked.push({ date: override.date, intervals: intervals.value });
  }
  return { ok: true, value: checked.sort((a, b) => a.date.localeCompare(b.date)) };
}

// The hours that apply on a date: its override, or the weekday's hours.
export function intervalsOn(availability: Availability, date: string, weekday: number): Interval[] {
  return (
    availability.overrides.find((override) => override.date === date)?.intervals ??
    availability.weekly[weekday] ??
    []
  );
}
