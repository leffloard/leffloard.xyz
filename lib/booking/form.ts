import { normalizeEmail } from "@/lib/intake/email";
import { cleanText } from "@/lib/intake/text";
import { isTimeZone } from "@/lib/intake/time";

// The booking form's rules, shared by the browser and the server (like the contact form's).

export const BOOKING_LIMITS = { name: 100, notes: 2000, answer: 1000 } as const;

export type BookingAnswerRule = { id: string; label: string; required: boolean };

export type BookingDetails = {
  start: Date;
  timeZone: string;
  name: string;
  email: string;
  notes: string;
  answers: { id: string; label: string; value: string }[];
};

export type BookingParse = { ok: true; data: BookingDetails } | { ok: false; errors: Record<string, string> };

// An ISO instant on a quarter hour, as the slot list gives them.
export function parseStart(value: unknown): Date | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() % (15 * 60_000) !== 0) return null;
  return date;
}

export function parseBookingForm(
  fields: Record<string, unknown>,
  questions: BookingAnswerRule[],
): BookingParse {
  const errors: Record<string, string> = {};

  const start = parseStart(fields.start);
  if (!start) errors.start = "Choose a time.";

  const zoneText = typeof fields.timeZone === "string" ? fields.timeZone : "";
  const timeZone = isTimeZone(zoneText) ? zoneText : null;
  if (!timeZone) errors.timeZone = "Choose your time zone.";

  const name = cleanText(fields.name, {
    maxLength: BOOKING_LIMITS.name,
    required: true,
    requiredMessage: "Tell me your name.",
  });
  if (!name.ok) errors.name = name.message;

  const emailText = typeof fields.email === "string" ? fields.email.trim() : "";
  const email = emailText ? normalizeEmail(emailText) : null;
  if (!email) errors.email = emailText ? "Enter a valid email address." : "Add your email address.";

  const notes = cleanText(fields.notes, { maxLength: BOOKING_LIMITS.notes, multiline: true });
  if (!notes.ok) errors.notes = notes.message;

  const given =
    fields.answers && typeof fields.answers === "object" && !Array.isArray(fields.answers)
      ? (fields.answers as Record<string, unknown>)
      : {};
  const answers: BookingDetails["answers"] = [];
  for (const question of questions) {
    const answer = cleanText(Object.hasOwn(given, question.id) ? given[question.id] : "", {
      maxLength: BOOKING_LIMITS.answer,
      multiline: true,
      required: question.required,
      requiredMessage: "Please answer this.",
    });
    if (!answer.ok) errors[`answers.${question.id}`] = answer.message;
    else if (answer.value) answers.push({ id: question.id, label: question.label, value: answer.value });
  }

  if (Object.keys(errors).length || !start || !timeZone || !name.ok || !email || !notes.ok) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    data: { start, timeZone, name: name.value!, email, notes: notes.value ?? "", answers },
  };
}
