import { describe, expect, it } from "vitest";
import {
  defaultRoutes,
  describeRange,
  notificationSettingsForm,
  quietUntil,
  type QuietRange,
} from "@/lib/notifications/model";

const ZONE = "Europe/Istanbul"; // UTC+3 all year
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
// Istanbul wall-clock time to an instant: "2026-09-28 08:00" is 05:00 UTC.
const at = (text: string) => new Date(`${text.replace(" ", "T")}:00+03:00`);

describe("quiet hours", () => {
  const night: QuietRange = { days: EVERY_DAY, start: "23:00", end: "07:00" };
  // Monday to Friday; 28 September 2026 is a Monday.
  const school: QuietRange = { days: [0, 1, 2, 3, 4], start: "07:00", end: "15:30" };

  it("isn't quiet outside the ranges", () => {
    expect(quietUntil([night], at("2026-09-26 14:00"), ZONE)).toBeNull();
    expect(quietUntil([night], at("2026-09-26 22:59"), ZONE)).toBeNull();
    expect(quietUntil([], at("2026-09-26 03:00"), ZONE)).toBeNull();
  });

  it("holds a night range past midnight, on either side of it", () => {
    expect(quietUntil([night], at("2026-09-26 23:00"), ZONE)).toEqual(at("2026-09-27 07:00"));
    expect(quietUntil([night], at("2026-09-27 02:30"), ZONE)).toEqual(at("2026-09-27 07:00"));
    expect(quietUntil([night], at("2026-09-27 07:00"), ZONE)).toBeNull();
  });

  it("counts a range that crosses midnight from the day it starts", () => {
    const fridayNight: QuietRange = { days: [4], start: "22:00", end: "09:00" };
    expect(quietUntil([fridayNight], at("2026-09-26 08:00"), ZONE)).toEqual(at("2026-09-26 09:00"));
    // Saturday night isn't in it.
    expect(quietUntil([fridayNight], at("2026-09-26 23:00"), ZONE)).toBeNull();
    expect(quietUntil([fridayNight], at("2026-09-27 08:00"), ZONE)).toBeNull();
  });

  it("follows ranges that continue each other: the night, then school", () => {
    expect(quietUntil([night, school], at("2026-09-28 01:00"), ZONE)).toEqual(at("2026-09-28 15:30"));
    // On Sunday there's no school.
    expect(quietUntil([night, school], at("2026-09-27 01:00"), ZONE)).toEqual(at("2026-09-27 07:00"));
    expect(quietUntil([school, night], at("2026-09-28 10:00"), ZONE)).toEqual(at("2026-09-28 15:30"));
  });

  it("takes the later end of overlapping ranges", () => {
    const morning: QuietRange = { days: EVERY_DAY, start: "06:00", end: "10:00" };
    expect(quietUntil([night, morning], at("2026-09-26 05:00"), ZONE)).toEqual(at("2026-09-26 10:00"));
  });

  it("stops following an always-quiet week after a bounded number of steps", () => {
    const always: QuietRange[] = [
      { days: EVERY_DAY, start: "00:00", end: "12:00" },
      { days: EVERY_DAY, start: "12:00", end: "00:00" },
    ];
    const until = quietUntil(always, at("2026-09-26 10:00"), ZONE);
    expect(until).not.toBeNull();
    expect(until!.getTime()).toBeGreaterThan(at("2026-09-26 10:00").getTime());
  });

  it("describes ranges", () => {
    expect(describeRange(night)).toBe("Every day, 23:00 to 07:00");
    expect(describeRange(school)).toBe("Mon to Fri, 07:00 to 15:30");
    expect(describeRange({ days: [5, 6], start: "00:00", end: "10:00" })).toBe("Sat, Sun, 00:00 to 10:00");
  });
});

describe("notification settings form", () => {
  const valid = {
    routes: defaultRoutes(),
    quietEnabled: true,
    quietRanges: [{ days: [6, 0, 0], start: "23:00", end: "07:00" }],
    digestEnabled: true,
    digestTime: "07:30",
    version: 0,
  };

  it("accepts settings and tidies the days", () => {
    const parsed = notificationSettingsForm.safeParse(valid);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.quietRanges[0]?.days).toEqual([0, 6]);
  });

  it("refuses empty days, equal times, bad times and unknown kinds", () => {
    const withRange = (range: Record<string, unknown>) => ({ ...valid, quietRanges: [range] });
    expect(
      notificationSettingsForm.safeParse(withRange({ days: [], start: "23:00", end: "07:00" })).success,
    ).toBe(false);
    expect(
      notificationSettingsForm.safeParse(withRange({ days: [0], start: "07:00", end: "07:00" })).success,
    ).toBe(false);
    expect(
      notificationSettingsForm.safeParse(withRange({ days: [0], start: "24:00", end: "07:00" })).success,
    ).toBe(false);
    expect(notificationSettingsForm.safeParse({ ...valid, digestTime: "7:30" }).success).toBe(false);
    expect(
      notificationSettingsForm.safeParse({
        ...valid,
        routes: { ...valid.routes, sms: { email: true, discord: true } },
      }).success,
    ).toBe(false);
  });
});
