// Calendar dates, wall-clock times and IANA time zones, without a date library. Dates are "YYYY-MM-DD"
// strings and times "HH:MM" (24-hour), exactly as the forms send them.

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// Each segment starts with a capital letter or a digit, as in the tz database ("Europe/Istanbul",
// "Etc/GMT+3", "America/Port-au-Prince"). Rules out offsets ("+03:00"), paths and lower-case spellings.
const ZONE_NAME = /^[A-Z][A-Za-z0-9_+-]*(?:\/[A-Z0-9][A-Za-z0-9_+-]*)*$/;
const NOT_ZONES = new Set(["Factory", "localtime"]);

let knownZones: Map<string, string> | undefined;

function zoneIndex(): Map<string, string> {
  if (!knownZones) {
    const names = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    knownZones = new Map(names.map((name) => [name.toLowerCase(), name]));
  }
  return knownZones;
}

export function isTimeZone(name: string): boolean {
  if (name.length > 64 || !ZONE_NAME.test(name) || NOT_ZONES.has(name)) return false;
  const known = zoneIndex().get(name.toLowerCase());
  if (known) return known === name; // the same zone in other letter case is a different string
  try {
    // Older names the list leaves out ("US/Eastern", "Asia/Calcutta" on some engines).
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

export function timeZoneNames(): string[] {
  return [...zoneIndex().values()].sort();
}

// A real day on the calendar (no 30 February), from year 1 on.
export function isCalendarDate(text: string): boolean {
  if (!DATE_PATTERN.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number) as [number, number, number];
  if (year < 1) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function wallClock(zone: string, at: Date): Parts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

// Today's date where the visitor is.
export function todayIn(zone: string, at: Date): string {
  const { year, month, day } = wallClock(zone, at);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const moved = new Date(0);
  moved.setUTCFullYear(year, month - 1, day + days);
  return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

function offsetMs(zone: string, at: Date): number {
  const wall = wallClock(zone, at);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

const DAY_MS = 86_400_000;

/**
 * The moment a wall-clock date and time in a zone happens, the way Python's zoneinfo reads it (fold 0):
 * an ambiguous time (clocks going back) is its first occurrence, and a time inside a daylight-saving gap
 * uses the offset from before the change, so it lands after the gap.
 */
export function zonedInstant(date: string, time: string, zone: string): Date | null {
  if (!isCalendarDate(date) || !TIME_PATTERN.test(time)) return null;
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  const base = new Date(0);
  base.setUTCFullYear(year, month - 1, day);
  base.setUTCHours(hour, minute, 0, 0);
  const wall = base.getTime();
  try {
    const before = offsetMs(zone, new Date(wall - DAY_MS));
    const after = offsetMs(zone, new Date(wall + DAY_MS));
    const matches = [wall - before, wall - after].filter(
      (instant) => instant + offsetMs(zone, new Date(instant)) === wall,
    );
    return new Date(matches.length ? Math.min(...matches) : wall - before);
  } catch {
    return null;
  }
}

// "Thursday, 1 October 2026 at 14:30 (Europe/Istanbul)", as the v1 emails wrote it.
export function describeMoment(at: Date, zone: string): string {
  let name = zone;
  let parts: Parts;
  try {
    parts = wallClock(zone, at);
  } catch {
    name = "UTC";
    parts = wallClock("UTC", at);
  }
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: name, weekday: "long" }).format(at);
  const monthName = new Intl.DateTimeFormat("en-GB", { timeZone: name, month: "long" }).format(at);
  return `${weekday}, ${parts.day} ${monthName} ${parts.year} at ${pad(parts.hour)}:${pad(parts.minute)} (${name})`;
}

// The date and time on a wall clock in a zone, as form values ("2026-10-01", "14:30").
export function wallDateTime(at: Date, zone: string): { date: string; time: string } {
  const parts = wallClock(zone, at);
  return {
    date: `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`,
    time: `${pad(parts.hour)}:${pad(parts.minute)}`,
  };
}

// "2026-10-01 11:30" in UTC.
export function utcStamp(at: Date): string {
  return at.toISOString().slice(0, 16).replace("T", " ");
}
