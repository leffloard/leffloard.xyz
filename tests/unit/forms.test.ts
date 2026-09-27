import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  amountSchema,
  dateSchema,
  durationSchema,
  emailSchema,
  notesText,
  optionalIdSchema,
  requiredText,
  tagsSchema,
  text,
  timeSchema,
  timeZoneSchema,
  urlSchema,
} from "@/lib/forms";
import { containsPattern, equalsIgnoringCase, escapeRegex } from "@/lib/search";

function parse<T extends z.ZodType>(schema: T, value: unknown) {
  const result = schema.safeParse(value);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, message: result.error.issues[0]?.message };
}

describe("text fields", () => {
  it("cleans text like the contact form and turns empty into null", () => {
    expect(parse(text({ maxLength: 10 }), "  Acme  ")).toEqual({ ok: true, value: "Acme" });
    expect(parse(text({ maxLength: 10 }), "   ")).toEqual({ ok: true, value: null });
    expect(parse(text({ maxLength: 3 }), "four")).toEqual({
      ok: false,
      message: "Must be 3 characters or fewer.",
    });
    expect(parse(text({ maxLength: 10 }), "a\u0000b")).toEqual({
      ok: false,
      message: "Contains characters that are not allowed.",
    });
  });

  it("requires what is required, with the field's own message", () => {
    expect(parse(requiredText(100, "Add a title."), " ")).toEqual({ ok: false, message: "Add a title." });
    expect(parse(requiredText(100, "Add a title."), "Ship it")).toEqual({ ok: true, value: "Ship it" });
  });

  it("keeps line breaks in notes and turns empty notes into an empty string", () => {
    expect(parse(notesText(100), "one\r\ntwo")).toEqual({ ok: true, value: "one\ntwo" });
    expect(parse(notesText(100), "")).toEqual({ ok: true, value: "" });
  });

  it("refuses huge input before cleaning it", () => {
    expect(parse(text({ maxLength: 10 }), "x".repeat(200)).ok).toBe(false);
  });
});

describe("structured fields", () => {
  it("reads email addresses", () => {
    expect(parse(emailSchema, " Ada@Example.COM ")).toEqual({ ok: true, value: "Ada@example.com" });
    expect(parse(emailSchema, "")).toEqual({ ok: true, value: null });
    expect(parse(emailSchema, "not an email")).toEqual({
      ok: false,
      message: "Enter a valid email address.",
    });
  });

  it("reads web addresses, adding https when it is missing", () => {
    expect(parse(urlSchema, "example.com/shop")).toEqual({ ok: true, value: "https://example.com/shop" });
    expect(parse(urlSchema, "http://staging.example.com")).toEqual({
      ok: true,
      value: "http://staging.example.com/",
    });
    expect(parse(urlSchema, "javascript:alert(1)")).toEqual({
      ok: false,
      message: "Only http and https addresses.",
    });
    expect(parse(urlSchema, "https://exa mple.com")).toEqual({
      ok: false,
      message: "Enter a web address, for example example.com.",
    });
    expect(parse(urlSchema, "")).toEqual({ ok: true, value: null });
  });

  it("reads dates, times and time zones", () => {
    expect(parse(dateSchema, "2026-02-28")).toEqual({ ok: true, value: "2026-02-28" });
    expect(parse(dateSchema, "2026-02-30")).toEqual({ ok: false, message: "Choose a valid date." });
    expect(parse(dateSchema, "")).toEqual({ ok: true, value: null });
    expect(parse(timeSchema, "09:30")).toEqual({ ok: true, value: "09:30" });
    expect(parse(timeSchema, "9:30")).toEqual({ ok: false, message: "Use the 24-hour HH:MM format." });
    expect(parse(timeZoneSchema, "Europe/Istanbul")).toEqual({ ok: true, value: "Europe/Istanbul" });
    expect(parse(timeZoneSchema, "Mars/Olympus")).toEqual({
      ok: false,
      message: "Choose a time zone from the list.",
    });
  });

  it("reads amounts and durations", () => {
    expect(parse(amountSchema, "1,250.50")).toEqual({ ok: true, value: 125_050 });
    expect(parse(amountSchema, "")).toEqual({ ok: true, value: null });
    expect(parse(amountSchema, "12,50").ok).toBe(false);
    expect(parse(durationSchema(), "1:30")).toEqual({ ok: true, value: 5400 });
    expect(parse(durationSchema(1000 * 3600), "300")).toEqual({ ok: true, value: 300 * 3600 });
  });

  it("reads optional ids from selects", () => {
    expect(parse(optionalIdSchema, "")).toEqual({ ok: true, value: null });
    expect(parse(optionalIdSchema, "0123456789abcdef01234567")).toEqual({
      ok: true,
      value: "0123456789abcdef01234567",
    });
    expect(parse(optionalIdSchema, "{$ne:1}")).toEqual({ ok: false, message: "Unknown item." });
  });

  it("reads tags", () => {
    expect(parse(tagsSchema, " Urgent, returning  client,urgent, ")).toEqual({
      ok: true,
      value: ["urgent", "returning client"],
    });
    expect(parse(tagsSchema, "")).toEqual({ ok: true, value: [] });
    expect(parse(tagsSchema, "$where").ok).toBe(false);
    expect(parse(tagsSchema, "a,b,c,d,e,f,g,h,i")).toEqual({ ok: false, message: "Use at most 8 tags." });
  });
});

describe("search", () => {
  it("escapes what the owner types", () => {
    expect(escapeRegex("a.b*(c)")).toBe("a\\.b\\*\\(c\\)");
    expect(containsPattern("  (Acme) ")).toEqual({ $regex: "\\(Acme\\)", $options: "i" });
    expect(containsPattern("   ")).toBeNull();
    expect(containsPattern(null)).toBeNull();
    expect(equalsIgnoringCase("a+b@example.com")).toEqual({ $regex: "^a\\+b@example\\.com$", $options: "i" });
  });
});
