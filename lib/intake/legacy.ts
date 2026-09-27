import { normalizeEmail } from "@/lib/intake/email";
import type { InquiryInput } from "@/lib/intake/form";
import { CALL_DURATIONS, DEFAULT_CALL_DURATION, LEGACY_SERVICES, MAX_DAYS_AHEAD } from "@/lib/intake/options";
import { cleanText, invalid, type Checked } from "@/lib/intake/text";
import { addDays, DATE_PATTERN, isCalendarDate, isTimeZone, TIME_PATTERN, todayIn } from "@/lib/intake/time";

// The v1 request form's API (POST /api/requests), kept so pages and scripts written for v1 keep working.
// A line-by-line port of schemas.py RequestCreate: the same fields, rules, order and messages. Fields are
// checked in order, and a rule that depends on an earlier field (the revision's project name, the
// appointment's date) only sees that field when it was valid, as in pydantic.

export const LEGACY_TYPES = ["appointment", "revision", "inquiry"] as const;
export type LegacyType = (typeof LEGACY_TYPES)[number];

export type LegacyRequest = {
  type: LegacyType;
  name: string;
  email: string;
  contact_handle: string | null;
  service: string | null;
  subject: string;
  message: string;
  project_reference: string | null;
  timezone: string | null;
  preferred_date: string | null;
  preferred_time: string | null;
  duration_minutes: number | null;
};

export type FieldError = { field: string; message: string };
export type LegacyParse = { ok: true; data: LegacyRequest } | { ok: false; errors: FieldError[] };

export const BODY_NOT_JSON: FieldError = { field: "body", message: "The request body must be valid JSON." };
export const BODY_NOT_OBJECT: FieldError = {
  field: "body",
  message: "The request body must be a JSON object.",
};

type Valid = Partial<LegacyRequest>;
type Rule = (value: unknown, valid: Valid, at: Date) => Checked<unknown>;

const text = (maxLength: number, requiredMessage?: string, multiline = false) =>
  ((value: unknown) =>
    cleanText(value, { maxLength, required: Boolean(requiredMessage), requiredMessage, multiline })) as Rule;

const RULES: [keyof LegacyRequest, Rule][] = [
  [
    "type",
    (value) => {
      if (value === null || value === undefined || value === "") return invalid("This field is required.");
      if (typeof value !== "string" || !(LEGACY_TYPES as readonly string[]).includes(value)) {
        return invalid("Choose appointment, revision or inquiry.");
      }
      return { ok: true, value };
    },
  ],
  ["name", text(80, "Please enter your name.")],
  [
    "email",
    (value) => {
      const checked = cleanText(value, {
        maxLength: 254,
        required: true,
        requiredMessage: "Please enter your email address.",
      });
      if (!checked.ok) return checked;
      const email = normalizeEmail(checked.value!);
      return email ? { ok: true, value: email } : invalid("Please enter a valid email address.");
    },
  ],
  ["contact_handle", text(80)],
  [
    "service",
    (value) => {
      const checked = cleanText(value, { maxLength: 80 });
      if (checked.ok && checked.value !== null && !Object.hasOwn(LEGACY_SERVICES, checked.value)) {
        return invalid("Please choose one of the listed services.");
      }
      return checked;
    },
  ],
  ["subject", text(120, "Please enter a subject.")],
  ["message", text(4000, "Please enter a message.", true)],
  [
    "project_reference",
    (value, valid) =>
      cleanText(value, {
        maxLength: 120,
        required: valid.type === "revision",
        requiredMessage: "Please enter the project or order name.",
      }),
  ],
  [
    "timezone",
    (value, valid) => {
      if (valid.type !== "appointment") return { ok: true, value: null };
      const checked = cleanText(value, {
        maxLength: 64,
        required: true,
        requiredMessage: "Please choose a time zone.",
      });
      if (!checked.ok) return checked;
      return isTimeZone(checked.value!) ? checked : invalid("Please choose a valid time zone.");
    },
  ],
  [
    "preferred_date",
    (value, valid, at) => {
      if (valid.type !== "appointment") return { ok: true, value: null };
      const checked = cleanText(value, {
        maxLength: 32,
        required: true,
        requiredMessage: "Please choose a date.",
      });
      if (!checked.ok) return checked;
      return checkCallDate(checked.value!, valid.timezone ?? "UTC", at);
    },
  ],
  [
    "preferred_time",
    (value, valid) => {
      if (valid.type !== "appointment") return { ok: true, value: null };
      const checked = cleanText(value, {
        maxLength: 32,
        required: true,
        requiredMessage: "Please choose a time.",
      });
      if (!checked.ok) return checked;
      return TIME_PATTERN.test(checked.value!)
        ? checked
        : invalid("Please use the 24-hour HH:MM time format.");
    },
  ],
  [
    "duration_minutes",
    (value, valid) => {
      if (valid.type !== "appointment") return { ok: true, value: null };
      return checkDuration(value);
    },
  ],
];

// Shared with the new contact form.
export function checkCallDate(date: string, zone: string, at: Date): Checked<string> {
  if (!DATE_PATTERN.test(date)) return invalid("Please use the YYYY-MM-DD date format.");
  if (!isCalendarDate(date)) return invalid("Please choose a valid date.");
  const today = todayIn(zone, at);
  if (date < today) return invalid("The date cannot be in the past.");
  if (date > addDays(today, MAX_DAYS_AHEAD)) {
    return invalid(`Please choose a date within the next ${MAX_DAYS_AHEAD} days.`);
  }
  return { ok: true, value: date };
}

export function checkDuration(value: unknown): Checked<number> {
  if (value === null || value === undefined || value === "")
    return { ok: true, value: DEFAULT_CALL_DURATION };
  let minutes = value;
  if (typeof minutes === "string" && /^\d+$/.test(minutes.trim())) minutes = Number(minutes.trim());
  if (typeof minutes !== "number" || !(CALL_DURATIONS as readonly number[]).includes(minutes)) {
    return invalid("Please choose 15, 30, 45 or 60 minutes.");
  }
  return { ok: true, value: minutes };
}

// The hidden "website" field that people never see and bots fill in. Anything but empty text counts.
export function honeypotFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return typeof value !== "string" || value.trim() !== "";
}

// A v1 request (from the API, or a stored v1 document) as a message for today's inbox.
export function legacyToInquiryInput(request: LegacyRequest): InquiryInput {
  const call =
    request.type === "appointment" && request.timezone && request.preferred_date && request.preferred_time
      ? {
          timeZone: request.timezone,
          date: request.preferred_date,
          time: request.preferred_time,
          duration: request.duration_minutes ?? DEFAULT_CALL_DURATION,
        }
      : null;
  return {
    kind: request.type === "appointment" ? "call" : request.type === "inquiry" ? "question" : "revision",
    name: request.name,
    email: request.email,
    contact: request.contact_handle,
    company: null,
    service: request.service ? (LEGACY_SERVICES[request.service] ?? "other") : null,
    subject: request.subject,
    message: request.message,
    budget: null,
    timeline: null,
    links: null,
    projectReference: request.project_reference,
    call,
    aiOptOut: false,
  };
}

export function parseLegacyRequest(payload: Record<string, unknown>, at: Date): LegacyParse {
  const valid: Valid = {};
  const errors: FieldError[] = [];
  for (const [field, rule] of RULES) {
    const result = rule(payload[field], valid, at);
    if (result.ok) (valid as Record<string, unknown>)[field] = result.value;
    else errors.push({ field, message: result.message });
  }
  return errors.length ? { ok: false, errors } : { ok: true, data: valid as LegacyRequest };
}
