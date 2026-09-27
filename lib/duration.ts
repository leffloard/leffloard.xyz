import { invalid, type Checked } from "@/lib/intake/text";

// Durations are stored in whole seconds. People type them as hours ("1.5"), clock time ("1:30") or with
// units ("90m", "1h 30m", "45 min").

export const MAX_ENTRY_SECONDS = 24 * 3600;

const CLOCK = /^(\d{1,4}):([0-5]\d)$/;
const HOURS = /^(\d{1,4}(?:\.\d{1,2})?|\.\d{1,2})$/;
const UNITS = /^(?:(\d{1,4}(?:\.\d{1,2})?)\s*h(?:ours?|rs?)?)?\s*(?:(\d{1,5})\s*m(?:in(?:utes?)?)?)?$/;

const HINT = "Use hours (1.5), hours and minutes (1:30) or units (1h 30m, 45m).";

// Empty text is null (no duration). Rounds to the minute.
export function parseDuration(text: string, { max = MAX_ENTRY_SECONDS } = {}): Checked<number | null> {
  const raw = text.trim().toLowerCase();
  if (!raw) return { ok: true, value: null };
  let minutes: number | null = null;
  const clock = CLOCK.exec(raw);
  if (clock) {
    minutes = Number(clock[1]) * 60 + Number(clock[2]);
  } else if (HOURS.test(raw)) {
    minutes = Math.round(Number(raw) * 60);
  } else {
    const units = UNITS.exec(raw);
    if (units && (units[1] !== undefined || units[2] !== undefined)) {
      minutes = Math.round(Number(units[1] ?? 0) * 60) + Number(units[2] ?? 0);
    }
  }
  if (minutes === null) return invalid(HINT);
  if (minutes <= 0) return invalid("Enter a duration of at least one minute.");
  if (minutes * 60 > max) return invalid(`Keep it under ${Math.round(max / 3600)} hours.`);
  return { ok: true, value: minutes * 60 };
}

// "1:05" (hours and minutes, rounded to the minute).
export function formatDuration(seconds: number): string {
  const minutes = Math.round(Math.max(seconds, 0) / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

// "1 h 5 min", "45 min", "3 h": for sentences and screen readers.
export function describeDuration(seconds: number): string {
  const minutes = Math.round(Math.max(seconds, 0) / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

// "12.5 h": totals and estimates.
export function formatHours(seconds: number): string {
  const hours = Math.round((Math.max(seconds, 0) / 3600) * 10) / 10;
  return `${hours} h`;
}

// "01:02:03": the running timer.
export function formatClock(seconds: number): string {
  const total = Math.max(Math.floor(seconds), 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}
