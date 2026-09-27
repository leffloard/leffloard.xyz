import { z } from "zod";
import { addDays, wallDateTime, zonedInstant } from "@/lib/intake/time";
import { weekdayIndex } from "@/lib/work/dates";

// What the owner is told about, where, and when. Every alert shows in the admin's notification centre;
// each kind can also go by email and to Discord, held during quiet hours until they end.

export const ALERT_KINDS = ["inquiry", "meeting", "quote", "payment", "portal", "problem"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const ALERT_KIND_INFO: Record<AlertKind, { label: string; description: string }> = {
  inquiry: { label: "New messages", description: "The contact form and the old request form." },
  meeting: { label: "Calls", description: "Bookings, requests, changes and cancellations." },
  quote: { label: "Quote answers", description: "A client accepted or declined a quote." },
  payment: { label: "Payments", description: "Payments received, and ones that need a look." },
  portal: { label: "Portal requests", description: "Revision and data requests from clients." },
  problem: {
    label: "Problems",
    description: "A recurring invoice or scheduled post that failed, a failed backup.",
  },
};

export type Route = { email: boolean; discord: boolean };
export type Routes = Record<AlertKind, Route>;

export function defaultRoutes(): Routes {
  return Object.fromEntries(ALERT_KINDS.map((kind) => [kind, { email: true, discord: true }])) as Routes;
}

// Monday first, as in the calendar.
export const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

// A quiet period on the days it starts; it may run past midnight into the next day ("23:00" to "07:00").
export type QuietRange = { days: number[]; start: string; end: string };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number) as [number, number];
  return hours * 60 + minutes;
}

// The latest end among the ranges `at` falls in; null when none.
function rangeEnd(ranges: readonly QuietRange[], at: Date, zone: string): Date | null {
  const { date, time } = wallDateTime(at, zone);
  const minute = minutesOf(time);
  const weekday = weekdayIndex(date);
  const yesterday = (weekday + 6) % 7;
  let latest: Date | null = null;
  for (const range of ranges) {
    const start = minutesOf(range.start);
    const end = minutesOf(range.end);
    let until: Date | null = null;
    if (start < end) {
      if (range.days.includes(weekday) && minute >= start && minute < end) {
        until = zonedInstant(date, range.end, zone);
      }
    } else if (range.days.includes(weekday) && minute >= start) {
      until = zonedInstant(addDays(date, 1), range.end, zone);
    } else if (range.days.includes(yesterday) && minute < end) {
      until = zonedInstant(date, range.end, zone);
    }
    if (until && until > at && (!latest || until > latest)) latest = until;
  }
  return latest;
}

// When the quiet period `at` falls in ends, following ranges that continue it (the night, then school);
// null when `at` isn't in quiet hours.
export function quietUntil(ranges: readonly QuietRange[], at: Date, zone: string): Date | null {
  let until: Date | null = null;
  let cursor = at;
  // A week of back-to-back ranges is at most a few dozen steps; the limit only guards against a loop.
  for (let step = 0; step < 32; step++) {
    const end = rangeEnd(ranges, cursor, zone);
    if (!end) break;
    until = end;
    cursor = end;
  }
  return until;
}

export const DEFAULT_QUIET_RANGES: QuietRange[] = [
  { days: [0, 1, 2, 3, 4, 5, 6], start: "23:00", end: "07:00" },
];
export const DEFAULT_DIGEST_TIME = "07:30";
export const MAX_QUIET_RANGES = 8;

const routeForm = z.object({ email: z.boolean(), discord: z.boolean() }).strict();

export const quietRangeForm = z
  .object({
    days: z
      .array(z.number().int().min(0).max(6))
      .max(7)
      .transform((days) => [...new Set(days)].sort())
      .pipe(z.array(z.number()).min(1, "Pick at least one day.")),
    start: z.string().regex(TIME, "Use a time such as 23:00."),
    end: z.string().regex(TIME, "Use a time such as 07:00."),
  })
  .strict()
  .refine((range) => range.start !== range.end, { message: "Start and end must differ.", path: ["end"] });

export const notificationSettingsForm = z
  .object({
    routes: z
      .object(
        Object.fromEntries(ALERT_KINDS.map((kind) => [kind, routeForm])) as Record<
          AlertKind,
          typeof routeForm
        >,
      )
      .strict(),
    quietEnabled: z.boolean(),
    quietRanges: z.array(quietRangeForm).max(MAX_QUIET_RANGES, `At most ${MAX_QUIET_RANGES} quiet periods.`),
    digestEnabled: z.boolean(),
    digestTime: z.string().regex(TIME, "Use a time such as 07:30."),
    version: z.number().int().min(0),
  })
  .strict();
export type NotificationSettingsForm = z.infer<typeof notificationSettingsForm>;

// "Every day, 23:00 to 07:00", "Mon to Fri, 08:30 to 15:30", "Sat, Sun, 00:00 to 10:00".
export function describeRange(range: QuietRange): string {
  const days = [...range.days].sort();
  let text: string;
  if (days.length === 7) text = "Every day";
  else if (days.length > 2 && days.every((day, index) => index === 0 || day === days[index - 1]! + 1)) {
    text = `${WEEKDAYS_SHORT[days[0]!]} to ${WEEKDAYS_SHORT[days.at(-1)!]}`;
  } else text = days.map((day) => WEEKDAYS_SHORT[day]).join(", ");
  return `${text}, ${range.start} to ${range.end}`;
}
