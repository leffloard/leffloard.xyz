import { SHORT_MONTHS } from "@/lib/format";
import { addDays } from "@/lib/intake/time";
import type { Recurrence } from "@/lib/work/options";

// Calendar-date helpers for tasks and projects. Dates are "YYYY-MM-DD" strings in the owner's time zone;
// "today" always comes from the caller, so these stay pure.

function noonUtc(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

// 0 is Monday, 6 is Sunday.
export function weekdayIndex(date: string): number {
  return (noonUtc(date).getUTCDay() + 6) % 7;
}

export function weekStart(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((noonUtc(to).getTime() - noonUtc(from).getTime()) / 86_400_000);
}

export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(0);
  target.setUTCFullYear(year, month - 1 + months, 1);
  // The same day of the month, or the last day of a shorter month.
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// "28 Sep", or "28 Sep 2027" outside the current year.
export function formatDay(date: string, today: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const text = `${day} ${SHORT_MONTHS[month - 1]}`;
  return date.slice(0, 4) === today.slice(0, 4) ? text : `${text} ${year}`;
}

export function weekdayName(date: string): string {
  return WEEKDAYS[weekdayIndex(date)]!;
}

// "Mon 28 Sep".
export function formatWeekday(date: string, today: string): string {
  return `${weekdayName(date).slice(0, 3)} ${formatDay(date, today)}`;
}

export type DueTone = "overdue" | "today" | "soon" | "later";

// How a due date reads in a list: "Today", "Tomorrow", "Wednesday", "2 days overdue", "12 Oct".
export function dueLabel(due: string, today: string): { text: string; tone: DueTone } {
  const days = daysBetween(today, due);
  if (days < 0) {
    return { text: days === -1 ? "Yesterday" : `${-days} days overdue`, tone: "overdue" };
  }
  if (days === 0) return { text: "Today", tone: "today" };
  if (days === 1) return { text: "Tomorrow", tone: "soon" };
  if (days < 7) return { text: weekdayName(due), tone: "soon" };
  return { text: formatDay(due, today), tone: "later" };
}

function step(date: string, recurrence: Recurrence): string {
  switch (recurrence) {
    case "daily":
      return addDays(date, 1);
    case "weekdays": {
      const next = addDays(date, 1);
      const weekday = weekdayIndex(next);
      return weekday < 5 ? next : addDays(next, 7 - weekday);
    }
    case "weekly":
      return addDays(date, 7);
    case "biweekly":
      return addDays(date, 14);
    case "monthly":
      return addMonths(date, 1);
  }
}

/**
 * The next date of a repeating task once it is done: one step after its due date (or after today when it
 * had none), and then on until the date is after today, so finishing a late task does not leave its next
 * turn already overdue.
 */
export function nextOccurrence(due: string | null, recurrence: Recurrence, today: string): string {
  const monthly = recurrence === "monthly" && due !== null;
  let next = step(due ?? today, recurrence);
  // Monthly steps are counted from the due date, so catching up never shifts the day of the month.
  for (let months = 2; next <= today; months++) {
    next = monthly ? addMonths(due!, months) : step(next, recurrence);
  }
  return next;
}
