import { SHORT_MONTHS } from "@/lib/format";

// Recurring invoices (care plans, hosting): how often, when the next one is due, and the period an invoice
// covers, which "{period}" in its title or lines is replaced with.

export const RECURRING_INTERVALS = ["month", "quarter", "year"] as const;
export type RecurringInterval = (typeof RECURRING_INTERVALS)[number];

export const RECURRING_INTERVAL_LABELS: Record<RecurringInterval, string> = {
  month: "Every month",
  quarter: "Every 3 months",
  year: "Every year",
};

const MONTHS: Record<RecurringInterval, number> = { month: 1, quarter: 3, year: 12 };

export const PERIOD_PLACEHOLDER = "{period}";

function parts(date: string): [number, number, number] {
  return date.split("-").map(Number) as [number, number, number];
}

const pad = (value: number) => String(value).padStart(2, "0");

// The date one interval later, on the day of the month the plan started (the 31st, or the month's last day
// when it is shorter), so a plan that started on 31 January is due on 28 February and then 31 March.
export function nextOccurrence(date: string, interval: RecurringInterval, anchorDay: number): string {
  const [year, month] = parts(date);
  const index = year * 12 + (month - 1) + MONTHS[interval];
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  return `${String(nextYear).padStart(4, "0")}-${pad(nextMonth)}-${pad(Math.min(anchorDay, lastDay))}`;
}

// The months an invoice due on a date covers: "October 2026", "Oct–Dec 2026", "Dec 2026 – Feb 2027".
export function periodLabel(date: string, interval: RecurringInterval): string {
  const [year, month] = parts(date);
  if (interval === "month") {
    const name = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(year, month - 1, 15)),
    );
    return `${name} ${year}`;
  }
  const endIndex = year * 12 + (month - 1) + MONTHS[interval] - 1;
  const endYear = Math.floor(endIndex / 12);
  const endMonth = SHORT_MONTHS[endIndex % 12]!;
  const startMonth = SHORT_MONTHS[month - 1]!;
  return endYear === year
    ? `${startMonth}–${endMonth} ${year}`
    : `${startMonth} ${year} – ${endMonth} ${endYear}`;
}

export function withPeriod(text: string, label: string): string {
  return text.split(PERIOD_PLACEHOLDER).join(label);
}
