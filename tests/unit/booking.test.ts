import { describe, expect, it } from "vitest";
import {
  checkIntervals,
  checkOverrides,
  DEFAULT_AVAILABILITY,
  minutesOf,
  type Availability,
} from "@/lib/booking/availability";
import { buildCalendar, escapeText, foldLine } from "@/lib/booking/ics";
import {
  availableSlots,
  blockedRange,
  cellsFor,
  heldRange,
  offersSlot,
  ownerDateOf,
} from "@/lib/booking/slots";

// 2026-09-28 is a Monday. Istanbul is UTC+3 all year.

function rules(overrides: Partial<Availability> = {}): Availability {
  return {
    timeZone: "Europe/Istanbul",
    weekly: [[{ start: "17:00", end: "19:00" }], [], [], [], [], [], []],
    overrides: [],
    bufferMinutes: 0,
    minNoticeMinutes: 0,
    horizonDays: 7,
    dailyCap: 0,
    stepMinutes: 30,
    ...overrides,
  };
}

const iso = (slots: Date[]) => slots.map((slot) => slot.toISOString().slice(0, 16));
const MONDAY_MORNING = new Date("2026-09-28T06:00:00Z");

describe("availability rules", () => {
  it("reads quarter-hour times", () => {
    expect(minutesOf("17:45")).toBe(17 * 60 + 45);
    expect(minutesOf("24:00")).toBe(24 * 60);
    expect(minutesOf("17:10")).toBeNull();
    expect(minutesOf("7:00")).toBeNull();
    expect(minutesOf("24:15")).toBeNull();
  });

  it("sorts a day's ranges and refuses bad ones", () => {
    expect(
      checkIntervals([
        { start: "18:00", end: "20:00" },
        { start: "09:00", end: "12:00" },
      ]),
    ).toEqual({
      ok: true,
      value: [
        { start: "09:00", end: "12:00" },
        { start: "18:00", end: "20:00" },
      ],
    });
    expect(checkIntervals([{ start: "20:00", end: "24:00" }]).ok).toBe(true);
    expect(checkIntervals([{ start: "12:00", end: "12:00" }])).toEqual({
      ok: false,
      message: "Each range has to end after it starts.",
    });
    expect(
      checkIntervals([
        { start: "09:00", end: "12:00" },
        { start: "11:00", end: "13:00" },
      ]),
    ).toEqual({
      ok: false,
      message: "Ranges on the same day overlap.",
    });
    expect(checkIntervals([{ start: "09:05", end: "10:00" }]).ok).toBe(false);
    expect(
      checkIntervals(Array.from({ length: 5 }, (_, i) => ({ start: `0${i}:00`, end: `0${i}:30` }))).ok,
    ).toBe(false);
  });

  it("checks special dates", () => {
    expect(
      checkOverrides([
        { date: "2026-10-02", intervals: [] },
        { date: "2026-10-01", intervals: [] },
      ]),
    ).toEqual({
      ok: true,
      value: [
        { date: "2026-10-01", intervals: [] },
        { date: "2026-10-02", intervals: [] },
      ],
    });
    expect(checkOverrides([{ date: "2026-02-30", intervals: [] }]).ok).toBe(false);
    expect(
      checkOverrides([
        { date: "2026-10-01", intervals: [] },
        { date: "2026-10-01", intervals: [] },
      ]).ok,
    ).toBe(false);
  });

  it("starts from a sensible default", () => {
    expect(DEFAULT_AVAILABILITY.weekly).toHaveLength(7);
    for (const day of DEFAULT_AVAILABILITY.weekly) expect(checkIntervals(day).ok).toBe(true);
  });
});

describe("the slot engine", () => {
  it("offers the owner's hours as instants, within the horizon", () => {
    const slots = availableSlots({
      availability: rules(),
      durationMinutes: 30,
      busy: [],
      dayCounts: {},
      now: MONDAY_MORNING,
    });
    // 17:00 to 18:30 in Istanbul; next Monday's are past the 7-day horizon (it ends Monday 06:00 UTC).
    expect(iso(slots)).toEqual([
      "2026-09-28T14:00",
      "2026-09-28T14:30",
      "2026-09-28T15:00",
      "2026-09-28T15:30",
    ]);
  });

  it("keeps the minimum notice", () => {
    const slots = availableSlots({
      availability: rules({ minNoticeMinutes: 60 }),
      durationMinutes: 30,
      busy: [],
      dayCounts: {},
      now: new Date("2026-09-28T13:50:00Z"),
    });
    expect(iso(slots)).toEqual(["2026-09-28T15:00", "2026-09-28T15:30"]);
  });

  it("keeps meetings a buffer apart and away from blocks", () => {
    const meeting = heldRange(new Date("2026-09-28T14:30:00Z"), 30, 15); // held until 15:15
    expect(meeting.end.toISOString()).toBe("2026-09-28T15:15:00.000Z");
    const withMeeting = availableSlots({
      availability: rules({ bufferMinutes: 15 }),
      durationMinutes: 30,
      busy: [meeting],
      dayCounts: {},
      now: MONDAY_MORNING,
    });
    expect(iso(withMeeting)).toEqual(["2026-09-28T15:30"]);

    const block = blockedRange(
      { start: new Date("2026-09-28T15:00:00Z"), end: new Date("2026-09-28T16:00:00Z") },
      15,
    );
    const withBlock = availableSlots({
      availability: rules({ bufferMinutes: 15 }),
      durationMinutes: 30,
      busy: [block],
      dayCounts: {},
      now: MONDAY_MORNING,
    });
    expect(iso(withBlock)).toEqual(["2026-09-28T14:00"]);
  });

  it("keeps one buffer before a block and one after it, like a meeting's", () => {
    // Hours 14:00-17:00 UTC, a block 15:00-15:30, a 15-minute buffer, 30-minute calls every 15 minutes.
    const block = blockedRange(
      { start: new Date("2026-09-28T15:00:00Z"), end: new Date("2026-09-28T15:30:00Z") },
      15,
    );
    expect(block).toEqual({ start: new Date("2026-09-28T15:00:00Z"), end: new Date("2026-09-28T15:45:00Z") });
    const slots = availableSlots({
      availability: rules({
        weekly: [[{ start: "17:00", end: "20:00" }], [], [], [], [], [], []],
        bufferMinutes: 15,
        stepMinutes: 15,
      }),
      durationMinutes: 30,
      busy: [block],
      dayCounts: {},
      now: MONDAY_MORNING,
    });
    // 14:15 ends at 14:45 and its own buffer reaches the block's start; 15:30 would start in the block's
    // buffer, so 15:45 is the first time after it.
    expect(iso(slots)).toEqual([
      "2026-09-28T14:00",
      "2026-09-28T14:15",
      "2026-09-28T15:45",
      "2026-09-28T16:00",
      "2026-09-28T16:15",
      "2026-09-28T16:30",
    ]);
  });

  it("stops offering a day at the daily limit, and follows special dates", () => {
    const full = availableSlots({
      availability: rules({ dailyCap: 2 }),
      durationMinutes: 30,
      busy: [],
      dayCounts: { "2026-09-28": 2 },
      now: MONDAY_MORNING,
    });
    expect(full).toEqual([]);
    const closed = availableSlots({
      availability: rules({ overrides: [{ date: "2026-09-28", intervals: [] }] }),
      durationMinutes: 30,
      busy: [],
      dayCounts: {},
      now: MONDAY_MORNING,
    });
    expect(closed).toEqual([]);
    const extra = availableSlots({
      availability: rules({
        overrides: [{ date: "2026-09-30", intervals: [{ start: "10:00", end: "11:00" }] }],
      }),
      durationMinutes: 60,
      busy: [],
      dayCounts: {},
      now: MONDAY_MORNING,
    });
    // Hour-long meetings: 17:00, 17:30 and 18:00 on Monday, and the extra hour on Wednesday.
    expect(iso(extra)).toEqual([
      "2026-09-28T14:00",
      "2026-09-28T14:30",
      "2026-09-28T15:00",
      "2026-09-30T07:00",
    ]);
  });

  it("uses the wall clock of the owner's zone across daylight-saving changes", () => {
    const berlin = (weekly: Availability["weekly"]) =>
      rules({ timeZone: "Europe/Berlin", weekly, horizonDays: 3 });
    const sunday = [[], [], [], [], [], [], [{ start: "01:00", end: "04:00" }]];
    // 29 March 2026: 02:00 becomes 03:00, so 01:00 to 04:00 is two hours.
    const spring = availableSlots({
      availability: berlin(sunday),
      durationMinutes: 30,
      busy: [],
      dayCounts: {},
      now: new Date("2026-03-27T12:00:00Z"),
    });
    expect(iso(spring)).toEqual([
      "2026-03-29T00:00",
      "2026-03-29T00:30",
      "2026-03-29T01:00",
      "2026-03-29T01:30",
    ]);
    // 25 October 2026: 03:00 becomes 02:00 again, so the same hours are four hours long.
    const autumn = availableSlots({
      availability: berlin(sunday),
      durationMinutes: 60,
      busy: [],
      dayCounts: {},
      now: new Date("2026-10-23T12:00:00Z"),
    });
    expect(iso(autumn)).toEqual([
      "2026-10-24T23:00",
      "2026-10-24T23:30",
      "2026-10-25T00:00",
      "2026-10-25T00:30",
      "2026-10-25T01:00",
      "2026-10-25T01:30",
      "2026-10-25T02:00",
    ]);
  });

  it("names the cells a meeting holds and the day it counts towards", () => {
    expect(cellsFor(new Date("2026-09-28T14:00:00Z"), 30, 15)).toEqual([
      "2026-09-28T14:00Z",
      "2026-09-28T14:15Z",
      "2026-09-28T14:30Z",
    ]);
    expect(() => cellsFor(new Date("2026-09-28T14:05:00Z"), 30, 0)).toThrow(RangeError);
    // 22:30 UTC is already the next day in Istanbul.
    expect(ownerDateOf(new Date("2026-09-28T22:30:00Z"), { timeZone: "Europe/Istanbul" })).toBe("2026-09-29");
    const slots = [new Date("2026-09-28T14:00:00Z")];
    expect(offersSlot(slots, new Date("2026-09-28T14:00:00.000Z"))).toBe(true);
    expect(offersSlot(slots, new Date("2026-09-28T14:15:00Z"))).toBe(false);
  });
});

describe("iCalendar", () => {
  it("escapes text so it can't start a new property", () => {
    expect(escapeText("a,b;c\\d\nnext")).toBe("a\\,b\\;c\\\\d\\nnext");
    expect(escapeText("x\r\nATTENDEE:mailto:evil@example.com")).toBe("x\\nATTENDEE:mailto:evil@example.com");
  });

  it("folds long lines at 75 octets without splitting a character", () => {
    const line = `DESCRIPTION:${"ğ".repeat(60)}`;
    const folded = foldLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(parts.slice(1).every((part) => part.startsWith(" "))).toBe(true);
    expect(parts.map((part, index) => (index ? part.slice(1) : part)).join("")).toBe(line);
    expect(foldLine("SHORT:line")).toBe("SHORT:line");
  });

  it("builds an invite and a feed", () => {
    const text = buildCalendar({
      method: "REQUEST",
      events: [
        {
          uid: "abc@leffloard.test",
          sequence: 2,
          stamp: new Date("2026-09-26T12:00:00Z"),
          summary: "Intro call",
          description: "Bring examples, links; anything",
          location: "https://meet.jit.si/leffloard-1",
          url: "https://meet.jit.si/leffloard-1",
          status: "CONFIRMED",
          organizer: { name: "Mert Kaan Koparan", email: "owner@leffloard.test" },
          attendee: { name: 'Ada "the countess"\r\nLovelace', email: "ada@example.com" },
          start: new Date("2026-10-01T14:00:00Z"),
          end: new Date("2026-10-01T14:30:00Z"),
          alarmMinutes: 15,
        },
      ],
    });
    const lines = text.split("\r\n");
    expect(text.endsWith("\r\n")).toBe(true);
    expect(lines).toContain("METHOD:REQUEST");
    expect(lines).toContain("DTSTART:20261001T140000Z");
    expect(lines).toContain("DTEND:20261001T143000Z");
    expect(lines).toContain("SEQUENCE:2");
    expect(lines).toContain("DESCRIPTION:Bring examples\\, links\\; anything");
    expect(lines).toContain("TRIGGER:-PT15M");
    expect(text).toContain('ATTENDEE;CN="Ada the countessLovelace"');
    expect(lines.filter((line) => line.startsWith("BEGIN:"))).toEqual([
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "BEGIN:VALARM",
    ]);

    const feed = buildCalendar({
      name: "leffloard",
      refreshMinutes: 30,
      events: [
        {
          uid: "task-1@leffloard.test",
          sequence: 0,
          stamp: new Date("2026-09-26T12:00:00Z"),
          summary: "Deploy",
          start: { date: "2026-10-05" },
          end: { date: "2026-10-06" },
        },
      ],
    });
    expect(feed).toContain("DTSTART;VALUE=DATE:20261005\r\n");
    expect(feed).toContain("X-WR-CALNAME:leffloard\r\n");
    expect(feed).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT30M\r\n");
    expect(feed).not.toContain("METHOD:");
  });
});
