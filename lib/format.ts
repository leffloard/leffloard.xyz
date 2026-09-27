// Dates in the admin are shown in the owner's time zone. (A setting later; Istanbul for now.)
export const ADMIN_TIME_ZONE = "Europe/Istanbul";

// Short month names are spelled out here: ICU versions disagree ("Sep" or "Sept"), and the server and the
// browser may run different ones.
export const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: ADMIN_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function wall(date: Date) {
  const values = Object.fromEntries(
    parts.formatToParts(date).map((part) => [part.type, part.value]),
  ) as Record<Intl.DateTimeFormatPartTypes, string>;
  return {
    day: Number(values.day),
    month: SHORT_MONTHS[Number(values.month) - 1]!,
    year: values.year,
    time: `${values.hour}:${values.minute}`,
  };
}

// "26 Sep 2026, 14:30"
export function formatDateTime(date: Date): string {
  const { day, month, year, time } = wall(date);
  return `${day} ${month} ${year}, ${time}`;
}

// "26 Sep 2026"
export function formatDate(date: Date): string {
  const { day, month, year } = wall(date);
  return `${day} ${month} ${year}`;
}

// "14:30"
export function formatTime(date: Date): string {
  return wall(date).time;
}

export function formatRelative(date: Date, now: Date = new Date()): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 45) return seconds <= 0 ? "just now" : "in a few seconds";
  if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return format.format(Math.round(seconds / 3600), "hour");
  if (abs < 30 * 86_400) return format.format(Math.round(seconds / 86_400), "day");
  return formatDateTime(date);
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

// "512 B", "14.2 KB", "3.1 MB" (powers of 1024).
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
