import { z } from "zod";
import { parseDuration } from "@/lib/duration";
import { normalizeEmail } from "@/lib/intake/email";
import { cleanText, type TextRule } from "@/lib/intake/text";
import { isCalendarDate, isTimeZone, TIME_PATTERN } from "@/lib/intake/time";
import { parseAmount } from "@/lib/money";

// Zod building blocks for the admin's forms. Each one cleans the raw text the way the contact form does
// (lib/intake/text.ts) and turns a mistake into a message for that field, which adminAction() returns.

// Raw input is capped well above every rule, so a huge value is refused before any cleaning.
const raw = (maxLength: number) => z.string().max(maxLength * 4 + 64, "That is too long.");

export const idSchema = z.string().regex(/^[a-f0-9]{24}$/, "Unknown item.");

// Optional ids arrive as "" from selects.
export const optionalIdSchema = z
  .string()
  .regex(/^(?:[a-f0-9]{24})?$/, "Unknown item.")
  .transform((value) => value || null);

export function text(rule: TextRule) {
  return raw(rule.maxLength).transform((value, context) => {
    const checked = cleanText(value, rule);
    if (!checked.ok) {
      context.addIssue({ code: "custom", message: checked.message });
      return z.NEVER;
    }
    return checked.value;
  });
}

export function requiredText(maxLength: number, requiredMessage: string, multiline = false) {
  return text({ maxLength, required: true, requiredMessage, multiline }).transform((value) => value!);
}

// Multi-line text that may be empty ("" rather than null, for notes).
export function notesText(maxLength: number) {
  return text({ maxLength, multiline: true }).transform((value) => value ?? "");
}

export const emailSchema = raw(254).transform((value, context) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const email = normalizeEmail(trimmed);
  if (!email) {
    context.addIssue({ code: "custom", message: "Enter a valid email address." });
    return z.NEVER;
  }
  return email;
});

export const urlSchema = raw(500).transform((value, context) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    context.addIssue({ code: "custom", message: "Enter a web address, for example example.com." });
    return z.NEVER;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    context.addIssue({ code: "custom", message: "Only http and https addresses." });
    return z.NEVER;
  }
  return url.toString();
});

export const dateSchema = raw(10).transform((value, context) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!isCalendarDate(trimmed)) {
    context.addIssue({ code: "custom", message: "Choose a valid date." });
    return z.NEVER;
  }
  return trimmed;
});

export const timeSchema = raw(5).transform((value, context) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!TIME_PATTERN.test(trimmed)) {
    context.addIssue({ code: "custom", message: "Use the 24-hour HH:MM format." });
    return z.NEVER;
  }
  return trimmed;
});

export const timeZoneSchema = raw(64).transform((value, context) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!isTimeZone(trimmed)) {
    context.addIssue({ code: "custom", message: "Choose a time zone from the list." });
    return z.NEVER;
  }
  return trimmed;
});

// An amount of money in minor units, or null when empty.
export const amountSchema = raw(24).transform((value, context) => {
  const parsed = parseAmount(value);
  if (!parsed.ok) {
    context.addIssue({ code: "custom", message: parsed.message });
    return z.NEVER;
  }
  return parsed.minor;
});

// A duration in seconds, or null when empty.
export function durationSchema(max?: number) {
  return raw(24).transform((value, context) => {
    const parsed = parseDuration(value, max === undefined ? {} : { max });
    if (!parsed.ok) {
      context.addIssue({ code: "custom", message: parsed.message });
      return z.NEVER;
    }
    return parsed.value;
  });
}

const TAG = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,23}$/u;
export const MAX_TAGS = 8;

// "urgent, Returning client" → ["urgent", "returning client"].
export const tagsSchema = raw(400).transform((value, context) => {
  const tags = [
    ...new Set(
      value
        .split(",")
        .map((tag) => tag.trim().replace(/\s+/g, " ").toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (tags.some((tag) => !TAG.test(tag))) {
    context.addIssue({
      code: "custom",
      message: "Tags use letters, digits, spaces, dots and dashes, up to 24 characters.",
    });
    return z.NEVER;
  }
  if (tags.length > MAX_TAGS) {
    context.addIssue({ code: "custom", message: `Use at most ${MAX_TAGS} tags.` });
    return z.NEVER;
  }
  return tags;
});

export const versionSchema = z.number().int().min(1);

export function fieldError(field: string, message: string) {
  return {
    ok: false as const,
    error: "Check the highlighted fields.",
    code: "invalid" as const,
    fieldErrors: { [field]: message },
  };
}
