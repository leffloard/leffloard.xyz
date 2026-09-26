import { describe, expect, it } from "vitest";
import { services } from "@/content/services";
import { normalizeEmail } from "@/lib/intake/email";
import { parseInquiryForm, type FormParse } from "@/lib/intake/form";
import { SERVICE_OPTIONS } from "@/lib/intake/options";
import { cleanText } from "@/lib/intake/text";
import {
  addDays,
  describeMoment,
  isCalendarDate,
  isTimeZone,
  todayIn,
  wallDateTime,
  zonedInstant,
} from "@/lib/intake/time";
import { snoozeUntil } from "@/lib/snooze";

const AT = new Date("2026-09-26T10:00:00Z");

describe("cleanText", () => {
  it("strips Python's whitespace, including \\x1c-\\x1f and \\x85 at the edges", () => {
    expect(cleanText("\x1c\x85 hi 　", { maxLength: 10 })).toEqual({ ok: true, value: "hi" });
  });

  it("refuses anything that is not text", () => {
    expect(cleanText(42, { maxLength: 10 })).toEqual({ ok: false, message: "Must be text." });
    expect(cleanText(["a"], { maxLength: 10 })).toEqual({ ok: false, message: "Must be text." });
  });

  it("treats null and a missing value as empty", () => {
    expect(cleanText(null, { maxLength: 10 })).toEqual({ ok: true, value: null });
    expect(cleanText(undefined, { maxLength: 10, required: true, requiredMessage: "Needed." })).toEqual({
      ok: false,
      message: "Needed.",
    });
  });
});

describe("normalizeEmail", () => {
  it.each([
    ["ada@example.com", "ada@example.com"],
    ["Ada.Lovelace+site@Example.COM", "Ada.Lovelace+site@example.com"],
    ["ali@örnek.com.tr", "ali@xn--rnek-4qa.com.tr"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it.each([
    "not-an-email",
    "Ada <ada@example.com>",
    "ada@",
    "@example.com",
    "a..b@example.com",
    ".ada@example.com",
    "ada@example",
    "ada@example.123",
    "ada@-bad.example.com",
    "ada@[127.0.0.1]",
    "ada@localhost",
    "ada@shop.local",
    "ada@leffloard.test",
    "şükrü@example.com",
    `${"a".repeat(65)}@example.com`,
    "ada@exa mple.com",
    "ada@example.com:25",
  ])("refuses %s", (input) => {
    expect(normalizeEmail(input)).toBeNull();
  });
});

describe("time zones and dates", () => {
  it.each([
    "Europe/Istanbul",
    "UTC",
    "America/Argentina/Buenos_Aires",
    "America/Port-au-Prince",
    "Etc/GMT+3",
  ])("knows %s", (zone) => {
    expect(isTimeZone(zone)).toBe(true);
  });

  it.each(["europe/istanbul", "EUROPE/ISTANBUL", "Factory", "localtime", "+03:00", "Mars/Olympus_Mons", ""])(
    "refuses %j",
    (zone) => {
      expect(isTimeZone(zone)).toBe(false);
    },
  );

  it("checks calendar dates, leap years included", () => {
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("0000-01-01")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
  });

  it("adds days across months and years", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("finds the moment of a wall-clock time, like Python's zoneinfo", () => {
    expect(zonedInstant("2026-10-01", "14:30", "Europe/Istanbul")?.toISOString()).toBe(
      "2026-10-01T11:30:00.000Z",
    );
    // Berlin skips 02:00-03:00 on 29 March 2026: 02:30 uses the winter offset and lands at 03:30.
    expect(zonedInstant("2026-03-29", "02:30", "Europe/Berlin")?.toISOString()).toBe(
      "2026-03-29T01:30:00.000Z",
    );
    // 02:30 happens twice on 25 October 2026; the first one (summer time) is used.
    expect(zonedInstant("2026-10-25", "02:30", "Europe/Berlin")?.toISOString()).toBe(
      "2026-10-25T00:30:00.000Z",
    );
    expect(zonedInstant("2026-02-30", "10:00", "UTC")).toBeNull();
  });

  it("describes moments the way the v1 emails did", () => {
    const at = new Date("2026-10-01T11:30:00Z");
    expect(describeMoment(at, "Europe/Istanbul")).toBe("Thursday, 1 October 2026 at 14:30 (Europe/Istanbul)");
    expect(describeMoment(at, "Not/AZone")).toBe("Thursday, 1 October 2026 at 11:30 (UTC)");
    expect(wallDateTime(at, "America/New_York")).toEqual({ date: "2026-10-01", time: "07:30" });
    expect(todayIn("Asia/Tokyo", new Date("2026-09-26T16:00:00Z"))).toBe("2026-09-27");
  });
});

describe("snoozeUntil", () => {
  it("brings messages back at 09:00 Istanbul time", () => {
    // A Saturday.
    expect(snoozeUntil("tomorrow", AT).toISOString()).toBe("2026-09-27T06:00:00.000Z");
    expect(snoozeUntil("3-days", AT).toISOString()).toBe("2026-09-29T06:00:00.000Z");
    expect(snoozeUntil("next-week", AT).toISOString()).toBe("2026-09-28T06:00:00.000Z");
    // On a Monday, "next Monday" is a week away.
    expect(snoozeUntil("next-week", new Date("2026-09-28T10:00:00Z")).toISOString()).toBe(
      "2026-10-05T06:00:00.000Z",
    );
  });
});

describe("the contact form rules", () => {
  const brief = (overrides: Record<string, unknown> = {}) => ({
    kind: "brief",
    service: "discord-bots",
    subject: "Moderation bot for my server",
    message: "It should warn, mute and log.",
    budget: "500-1500",
    timeline: "1-month",
    links: "https://example.com/server",
    company: "",
    name: "Alan Turing",
    email: "alan@example.com",
    contact: "",
    aiOptOut: true,
    ...overrides,
  });

  const errorsOf = (result: FormParse) => (result.ok ? {} : result.errors);

  it("accepts a complete project brief", () => {
    const result = parseInquiryForm(brief(), AT);
    expect(result).toEqual({
      ok: true,
      data: {
        kind: "brief",
        name: "Alan Turing",
        email: "alan@example.com",
        contact: null,
        company: null,
        service: "discord-bots",
        subject: "Moderation bot for my server",
        message: "It should warn, mute and log.",
        budget: "500-1500",
        timeline: "1-month",
        links: "https://example.com/server",
        projectReference: null,
        call: null,
        aiOptOut: true,
      },
    });
  });

  it("asks for what each kind needs", () => {
    expect(errorsOf(parseInquiryForm({ kind: "brief" }, AT))).toEqual({
      name: "Please enter your name.",
      email: "Please enter your email address.",
      subject: "Please sum up the project in one line.",
      message: "Please describe the project.",
      service: "Choose the kind of project.",
    });
    expect(Object.keys(errorsOf(parseInquiryForm({ kind: "revision" }, AT))).sort()).toEqual(
      ["email", "message", "name", "projectReference", "subject"].sort(),
    );
    expect(Object.keys(errorsOf(parseInquiryForm({ kind: "call" }, AT))).sort()).toEqual(
      ["date", "email", "message", "name", "subject", "time", "timeZone"].sort(),
    );
    expect(errorsOf(parseInquiryForm({ kind: "meeting" }, AT))).toHaveProperty(
      "kind",
      "Choose what you need.",
    );
  });

  it("refuses values that are not on the lists", () => {
    const found = errorsOf(
      parseInquiryForm(brief({ service: "hacking", budget: "free", timeline: "yesterday" }), AT),
    );
    expect(found).toEqual({
      service: "Please choose one of the listed services.",
      budget: "Please choose one of the listed budgets.",
      timeline: "Please choose one of the listed timelines.",
    });
  });

  it("ignores fields that belong to other kinds", () => {
    const result = parseInquiryForm(
      {
        kind: "question",
        name: "A",
        email: "a@example.com",
        subject: "Hi",
        message: "Hello",
        service: "nope",
        date: "x",
      },
      AT,
    );
    expect(result.ok && result.data).toMatchObject({ service: null, call: null, budget: null });
  });

  it("checks a call's date in the visitor's time zone", () => {
    const call = (overrides: Record<string, unknown>) =>
      parseInquiryForm(
        {
          kind: "call",
          name: "Ada",
          email: "ada@example.com",
          subject: "Kickoff",
          message: "Let's talk",
          timeZone: "Pacific/Kiritimati",
          date: "2026-09-27",
          time: "09:00",
          ...overrides,
        },
        AT,
      );
    const accepted = call({});
    expect(accepted.ok && accepted.data.call).toEqual({
      timeZone: "Pacific/Kiritimati",
      date: "2026-09-27",
      time: "09:00",
      duration: 30,
    });
    expect(errorsOf(call({ date: "2026-09-26" }))).toEqual({ date: "The date cannot be in the past." });
    expect(errorsOf(call({ timeZone: "Mars/Base" }))).toEqual({
      timeZone: "Please choose a valid time zone.",
    });
    expect(errorsOf(call({ time: "25:00" }))).toEqual({ time: "Please use the 24-hour HH:MM time format." });
    expect(errorsOf(call({ duration: 20 }))).toEqual({ duration: "Please choose 15, 30, 45 or 60 minutes." });
  });

  it("keeps the service list in step with the services pages", () => {
    expect(SERVICE_OPTIONS.map((option) => option.value)).toEqual([
      ...services.map((service) => service.slug),
      "other",
    ]);
  });
});
