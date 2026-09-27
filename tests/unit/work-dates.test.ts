import { describe, expect, it } from "vitest";
import {
  addMonths,
  daysBetween,
  dueLabel,
  formatDay,
  formatWeekday,
  nextOccurrence,
  weekdayIndex,
  weekStart,
} from "@/lib/work/dates";
import { describeDuration, formatClock, formatDuration, formatHours, parseDuration } from "@/lib/duration";

// 2026-09-28 is a Monday.

describe("calendar helpers", () => {
  it("finds the weekday and the Monday of a week", () => {
    expect(weekdayIndex("2026-09-28")).toBe(0);
    expect(weekdayIndex("2026-10-04")).toBe(6);
    expect(weekStart("2026-10-04")).toBe("2026-09-28");
    expect(weekStart("2026-09-28")).toBe("2026-09-28");
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
  });

  it("counts days across a daylight-saving change and a year end", () => {
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(daysBetween("2026-10-02", "2026-09-30")).toBe(-2);
  });

  it("adds months, keeping the day or using the month's last day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-15", 2)).toBe("2027-01-15");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  });

  it("formats days, with the year only when it differs", () => {
    expect(formatDay("2026-10-12", "2026-09-26")).toBe("12 Oct");
    expect(formatDay("2027-01-03", "2026-09-26")).toBe("3 Jan 2027");
    expect(formatWeekday("2026-09-28", "2026-09-26")).toBe("Mon 28 Sep");
  });
});

describe("dueLabel", () => {
  const today = "2026-09-28";
  it.each([
    ["2026-09-25", "3 days overdue", "overdue"],
    ["2026-09-27", "Yesterday", "overdue"],
    ["2026-09-28", "Today", "today"],
    ["2026-09-29", "Tomorrow", "soon"],
    ["2026-10-02", "Friday", "soon"],
    ["2026-10-05", "5 Oct", "later"],
  ])("%s reads %s", (due, text, tone) => {
    expect(dueLabel(due, today)).toEqual({ text, tone });
  });
});

describe("nextOccurrence", () => {
  const today = "2026-09-28"; // Monday
  it.each([
    ["daily, done on the day", "2026-09-28", "daily", "2026-09-29"],
    ["daily, done three days late", "2026-09-25", "daily", "2026-09-29"],
    ["weekdays from Friday", "2026-10-02", "weekdays", "2026-10-05"],
    ["weekdays from a late Friday", "2026-09-25", "weekdays", "2026-09-29"],
    ["weekly, early", "2026-09-30", "weekly", "2026-10-07"],
    ["weekly, ten days late", "2026-09-18", "weekly", "2026-10-02"],
    ["biweekly", "2026-09-28", "biweekly", "2026-10-12"],
    ["monthly on the 31st", "2026-10-31", "monthly", "2026-11-30"],
    ["monthly, two months late", "2026-07-31", "monthly", "2026-09-30"],
  ] as const)("%s", (_name, due, recurrence, expected) => {
    expect(nextOccurrence(due, recurrence, today)).toBe(expected);
  });

  it("counts from today when the task had no date", () => {
    expect(nextOccurrence(null, "weekly", today)).toBe("2026-10-05");
    expect(nextOccurrence(null, "weekdays", "2026-10-02")).toBe("2026-10-05");
  });
});

describe("durations", () => {
  it.each([
    ["1.5", 5400],
    ["2", 7200],
    [".25", 900],
    ["1:30", 5400],
    ["0:05", 300],
    ["90m", 5400],
    ["45 min", 2700],
    ["1h 30m", 5400],
    ["1h30m", 5400],
    ["2 hours", 7200],
    ["1.5 hrs", 5400],
    ["24", 86_400],
  ])("reads %j as %d seconds", (text, seconds) => {
    expect(parseDuration(text)).toEqual({ ok: true, value: seconds });
  });

  it("reads empty text as no duration", () => {
    expect(parseDuration("")).toEqual({ ok: true, value: null });
  });

  it.each(["abc", "1:75", "100", "-1", "1,5", "h", "m"])("refuses %j", (text) => {
    expect(parseDuration(text).ok).toBe(false);
  });

  it("refuses zero and more than a day", () => {
    expect(parseDuration("0")).toEqual({ ok: false, message: "Enter a duration of at least one minute." });
    expect(parseDuration("24:01")).toEqual({ ok: false, message: "Keep it under 24 hours." });
    expect(parseDuration("3", { max: 2 * 3600 })).toEqual({ ok: false, message: "Keep it under 2 hours." });
  });

  it("formats durations", () => {
    expect(formatDuration(5_430)).toBe("1:31");
    expect(formatDuration(59)).toBe("0:01");
    expect(formatDuration(0)).toBe("0:00");
    expect(describeDuration(3_900)).toBe("1 h 5 min");
    expect(describeDuration(2_700)).toBe("45 min");
    expect(describeDuration(7_200)).toBe("2 h");
    expect(formatHours(45_000)).toBe("12.5 h");
    expect(formatClock(3_723.9)).toBe("01:02:03");
  });
});
