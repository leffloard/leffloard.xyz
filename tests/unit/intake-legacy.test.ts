import { describe, expect, it } from "vitest";
import {
  honeypotFilled,
  legacyToInquiryInput,
  parseLegacyRequest,
  type LegacyParse,
} from "@/lib/intake/legacy";
import { addDays, todayIn } from "@/lib/intake/time";

// Ported from the v1 backend's tests/test_requests_api.py (field rules). See tests/legacy-parity.md.

const AT = new Date("2026-09-26T10:00:00Z");
const futureDate = (days = 7, zone = "Europe/Istanbul") => addDays(todayIn(zone, AT), days);

const appointment = (overrides: Record<string, unknown> = {}) => ({
  type: "appointment",
  name: "Ada Lovelace",
  email: "ada@example.com",
  contact_handle: "ada#0001",
  service: "Web Development",
  subject: "Kickoff call",
  message: "Let's plan the new landing page.",
  preferred_date: futureDate(),
  preferred_time: "14:30",
  timezone: "Europe/Istanbul",
  duration_minutes: 45,
  website: "",
  ...overrides,
});

const revision = (overrides: Record<string, unknown> = {}) => ({
  type: "revision",
  name: "Grace Hopper",
  email: "grace@example.com",
  subject: "Change the hero colours",
  message: "Please make the hero section darker.",
  project_reference: "Order #1042 - Portfolio",
  ...overrides,
});

const inquiry = (overrides: Record<string, unknown> = {}) => ({
  type: "inquiry",
  name: "Alan Turing",
  email: "alan@example.com",
  subject: "Discord bot pricing",
  message: "How much would a moderation bot cost?",
  ...overrides,
});

const parse = (payload: Record<string, unknown>, at = AT) => parseLegacyRequest(payload, at);

function errors(result: LegacyParse): Record<string, string> {
  expect(result.ok).toBe(false);
  if (result.ok) return {};
  for (const error of result.errors) expect(error.message).toBeTruthy();
  return Object.fromEntries(result.errors.map((error) => [error.field, error.message]));
}

function data(result: LegacyParse) {
  if (!result.ok) throw new Error(`expected valid input, got ${JSON.stringify(result.errors)}`);
  return result.data;
}

describe("the v1 request rules", () => {
  it("accepts an appointment and ignores unknown fields", () => {
    expect(data(parse(appointment({ extra_field: "ignored" })))).toEqual({
      type: "appointment",
      name: "Ada Lovelace",
      email: "ada@example.com",
      contact_handle: "ada#0001",
      service: "Web Development",
      subject: "Kickoff call",
      message: "Let's plan the new landing page.",
      project_reference: null,
      timezone: "Europe/Istanbul",
      preferred_date: futureDate(),
      preferred_time: "14:30",
      duration_minutes: 45,
    });
  });

  it("accepts an inquiry with only the required fields", () => {
    const request = data(parse(inquiry()));
    for (const key of [
      "contact_handle",
      "service",
      "project_reference",
      "preferred_date",
      "preferred_time",
      "timezone",
      "duration_minutes",
    ] as const) {
      expect(request[key]).toBeNull();
    }
  });

  it("ignores appointment fields for other types", () => {
    const request = data(
      parse(
        inquiry({
          preferred_date: "not a date",
          preferred_time: "99:99",
          timezone: "Nowhere",
          duration_minutes: 7,
        }),
      ),
    );
    expect([request.preferred_date, request.timezone, request.duration_minutes]).toEqual([null, null, null]);
  });

  it("strips strings and turns empty optional fields into null", () => {
    const request = data(
      parse(
        inquiry({
          name: "  Alan Turing  ",
          subject: "\tPricing ",
          message: "\n Hello \n",
          contact_handle: "   ",
          service: "",
        }),
      ),
    );
    expect(request).toMatchObject({
      name: "Alan Turing",
      subject: "Pricing",
      message: "Hello",
      contact_handle: null,
      service: null,
    });
  });

  it("requires the project name for a revision", () => {
    expect(Object.keys(errors(parse(revision({ project_reference: "  " }))))).toEqual(["project_reference"]);
    expect(parse(revision()).ok).toBe(true);
  });

  it("requires date, time and time zone for an appointment", () => {
    const payload: Record<string, unknown> = appointment();
    delete payload.preferred_date;
    delete payload.preferred_time;
    delete payload.timezone;
    expect(Object.keys(errors(parse(payload))).sort()).toEqual([
      "preferred_date",
      "preferred_time",
      "timezone",
    ]);
  });

  it("lists every missing common field, with v1's messages", () => {
    const found = errors(parse({}));
    expect(Object.keys(found)).toEqual(["type", "name", "email", "subject", "message"]);
    expect(found.name).toBe("Please enter your name.");
    expect(found.type).toBe("This field is required.");
  });

  it.each([
    ["type", "meeting"],
    ["type", 3],
    ["name", "x".repeat(81)],
    ["name", 42],
    ["email", "not-an-email"],
    ["email", `${"a".repeat(245)}@example.com`],
    ["email", "Ada <ada@example.com>"],
    ["contact_handle", "x".repeat(81)],
    ["service", "Hacking"],
    ["subject", "x".repeat(121)],
    ["subject", "   "],
    ["message", "x".repeat(4001)],
    ["message", ""],
    ["project_reference", "x".repeat(121)],
  ])("refuses %s = %j", (field, value) => {
    expect(errors(parse(revision({ [field]: value })))).toHaveProperty(field);
  });

  it("includes the limits themselves", () => {
    expect(
      parse(
        inquiry({
          name: "n".repeat(80),
          subject: "s".repeat(120),
          message: "m".repeat(4000),
          contact_handle: "c".repeat(80),
        }),
      ).ok,
    ).toBe(true);
    expect(parse(revision({ project_reference: "p".repeat(120) })).ok).toBe(true);
  });

  it("counts characters like Python: an emoji is one", () => {
    expect(parse(inquiry({ name: "😀".repeat(80) })).ok).toBe(true);
    expect(errors(parse(inquiry({ name: "😀".repeat(81) })))).toHaveProperty("name");
  });

  it.each(["Web Development", "Discord Bot", "Authentication System", "Loader / Desktop App", "Other"])(
    "accepts the listed service %s",
    (service) => {
      expect(parse(inquiry({ service })).ok).toBe(true);
    },
  );

  it("does not treat object methods as services", () => {
    expect(errors(parse(inquiry({ service: "toString" })))).toHaveProperty("service");
  });

  it.each([
    ["name", "Ada\x00"],
    ["subject", "\x1b[31mred"],
    ["email", "ada@example.com\x7f"],
    ["contact_handle", "a\u0085da"],
  ])("refuses control characters in %s", (field, value) => {
    expect(errors(parse(appointment({ [field]: value })))).toHaveProperty(field);
  });

  it("keeps line breaks and tabs in the message, but no other control characters", () => {
    expect(data(parse(inquiry({ message: "Line one\r\nLine two\n\tindented" }))).message).toBe(
      "Line one\nLine two\n\tindented",
    );
    expect(errors(parse(inquiry({ message: "Ring \x07 bell" })))).toHaveProperty("message");
  });

  it("turns Unicode line separators into line breaks in the message and spaces elsewhere", () => {
    const request = data(
      parse(inquiry({ name: "Ann\u2028Lee", subject: "Quote\u2029for site", message: "One\u2028two" })),
    );
    expect([request.name, request.subject, request.message]).toEqual([
      "Ann Lee",
      "Quote for site",
      "One\ntwo",
    ]);
  });

  it("allows today and up to 120 days ahead", () => {
    const today = todayIn("UTC", AT);
    const submit = (day: string) => parse(appointment({ timezone: "UTC", preferred_date: day }));
    expect(submit(today).ok).toBe(true);
    expect(submit(addDays(today, 120)).ok).toBe(true);
    expect(errors(submit(addDays(today, -1))).preferred_date).toBe("The date cannot be in the past.");
    expect(errors(submit(addDays(today, 121))).preferred_date).toContain("120 days");
  });

  it("uses the visitor's time zone for today", () => {
    // 10:00 UTC is already the 27th in Kiritimati (UTC+14) and still the 25th in Pago Pago (UTC-11).
    expect(todayIn("Pacific/Kiritimati", AT)).toBe("2026-09-27");
    expect(todayIn("Pacific/Pago_Pago", AT)).toBe("2026-09-25");
    for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
      const localToday = todayIn(zone, AT);
      expect(parse(appointment({ timezone: zone, preferred_date: localToday })).ok).toBe(true);
      expect(
        errors(parse(appointment({ timezone: zone, preferred_date: addDays(localToday, -1) }))),
      ).toHaveProperty("preferred_date");
    }
  });

  it.each(["2026/10/01", "01-10-2026", "2026-02-30", "20261001", "tomorrow", 20261001])(
    "refuses the date %j",
    (value) => {
      expect(errors(parse(appointment({ preferred_date: value })))).toHaveProperty("preferred_date");
    },
  );

  it.each(["24:00", "7:30", "14:30:00", "14:60", "2pm", ""])("refuses the time %j", (value) => {
    expect(errors(parse(appointment({ preferred_time: value })))).toHaveProperty("preferred_time");
  });

  it("accepts midnight", () => {
    expect(parse(appointment({ preferred_time: "00:00" })).ok).toBe(true);
  });

  it.each([
    "Mars/Olympus_Mons",
    "europe/istanbul",
    "../../etc/passwd",
    "localtime",
    "+03:00",
    "x".repeat(65),
  ])("refuses the time zone %j", (value) => {
    expect(errors(parse(appointment({ timezone: value })))).toHaveProperty("timezone");
  });

  it("defaults the duration to 30 minutes and accepts only 15, 30, 45 or 60", () => {
    const payload: Record<string, unknown> = appointment();
    delete payload.duration_minutes;
    expect(data(parse(payload)).duration_minutes).toBe(30);
    for (const minutes of [15, 30, 45, 60])
      expect(data(parse(appointment({ duration_minutes: minutes }))).duration_minutes).toBe(minutes);
    expect(data(parse(appointment({ duration_minutes: " 45 " }))).duration_minutes).toBe(45);
    for (const bad of [20, 0, 90, true, "long"]) {
      expect(errors(parse(appointment({ duration_minutes: bad })))).toHaveProperty("duration_minutes");
    }
  });
});

describe("honeypotFilled", () => {
  it("is true for anything but empty text", () => {
    expect(honeypotFilled(undefined)).toBe(false);
    expect(honeypotFilled(null)).toBe(false);
    expect(honeypotFilled("")).toBe(false);
    expect(honeypotFilled("   ")).toBe(false);
    expect(honeypotFilled("https://spam.example")).toBe(true);
    expect(honeypotFilled(0)).toBe(true);
    expect(honeypotFilled({})).toBe(true);
  });
});

describe("legacyToInquiryInput", () => {
  it("maps v1 types and services to today's kinds and services", () => {
    const call = legacyToInquiryInput(data(parse(appointment())));
    expect(call).toMatchObject({
      kind: "call",
      contact: "ada#0001",
      service: "websites",
      call: { timeZone: "Europe/Istanbul", date: futureDate(), time: "14:30", duration: 45 },
      aiOptOut: false,
    });
    expect(legacyToInquiryInput(data(parse(inquiry({ service: "Loader / Desktop App" }))))).toMatchObject({
      kind: "question",
      service: "desktop-software",
      call: null,
    });
    expect(legacyToInquiryInput(data(parse(revision())))).toMatchObject({
      kind: "revision",
      projectReference: "Order #1042 - Portfolio",
    });
  });
});
