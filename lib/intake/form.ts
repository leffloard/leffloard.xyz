import { normalizeEmail } from "@/lib/intake/email";
import { checkCallDate, checkDuration } from "@/lib/intake/legacy";
import {
  BUDGET_OPTIONS,
  INQUIRY_KINDS,
  SERVICE_OPTIONS,
  TIMELINE_OPTIONS,
  type InquiryKind,
} from "@/lib/intake/options";
import { cleanText, invalid, type Checked } from "@/lib/intake/text";
import { isTimeZone, TIME_PATTERN } from "@/lib/intake/time";

// The contact form (POST /api/inquiries). The text rules are the v1 ones; the fields depend on what the
// visitor needs. Runs in the browser for instant feedback and again on the server, which decides.

export type CallSlot = { timeZone: string; date: string; time: string; duration: number };

export type InquiryInput = {
  kind: InquiryKind;
  name: string;
  email: string;
  contact: string | null;
  company: string | null;
  service: string | null;
  subject: string;
  message: string;
  budget: string | null;
  timeline: string | null;
  links: string | null;
  projectReference: string | null;
  call: CallSlot | null;
  aiOptOut: boolean;
};

export const FORM_FIELDS = [
  "kind",
  "service",
  "subject",
  "message",
  "budget",
  "timeline",
  "links",
  "projectReference",
  "timeZone",
  "date",
  "time",
  "duration",
  "name",
  "email",
  "contact",
  "company",
  "aiOptOut",
] as const;
export type FormField = (typeof FORM_FIELDS)[number];
export type FormErrors = Partial<Record<FormField, string>>;

export const LIMITS = {
  name: 80,
  email: 254,
  contact: 80,
  company: 120,
  subject: 120,
  message: 4000,
  links: 1000,
  projectReference: 120,
} as const;

function choice(
  options: readonly { value: string }[],
  message: string,
  requiredMessage?: string,
): (value: unknown) => Checked<string | null> {
  return (value) => {
    const checked = cleanText(value, { maxLength: 40, required: Boolean(requiredMessage), requiredMessage });
    if (!checked.ok || checked.value === null) return checked;
    return options.some((option) => option.value === checked.value) ? checked : invalid(message);
  };
}

const checkService = choice(
  SERVICE_OPTIONS,
  "Please choose one of the listed services.",
  "Choose the kind of project.",
);
const checkBudget = choice(BUDGET_OPTIONS, "Please choose one of the listed budgets.");
const checkTimeline = choice(TIMELINE_OPTIONS, "Please choose one of the listed timelines.");

function checkBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === "on";
}

export type FormParse = { ok: true; data: InquiryInput } | { ok: false; errors: FormErrors };

export function parseInquiryForm(payload: Record<string, unknown>, at: Date): FormParse {
  const errors: FormErrors = {};
  const take = <T>(field: FormField, result: Checked<T>): T | null => {
    if (result.ok) return result.value;
    errors[field] ??= result.message;
    return null;
  };

  const kindValue = payload.kind;
  const kind = (INQUIRY_KINDS as readonly unknown[]).includes(kindValue) ? (kindValue as InquiryKind) : null;
  if (!kind) errors.kind = "Choose what you need.";

  const name = take(
    "name",
    cleanText(payload.name, {
      maxLength: LIMITS.name,
      required: true,
      requiredMessage: "Please enter your name.",
    }),
  );
  const emailText = take(
    "email",
    cleanText(payload.email, {
      maxLength: LIMITS.email,
      required: true,
      requiredMessage: "Please enter your email address.",
    }),
  );
  const email = emailText === null ? null : normalizeEmail(emailText);
  if (emailText !== null && !email) errors.email = "Please enter a valid email address.";
  const contact = take("contact", cleanText(payload.contact, { maxLength: LIMITS.contact }));

  const brief = kind === "brief";
  const subject = take(
    "subject",
    cleanText(payload.subject, {
      maxLength: LIMITS.subject,
      required: true,
      requiredMessage: brief ? "Please sum up the project in one line." : "Please enter a subject.",
    }),
  );
  const message = take(
    "message",
    cleanText(payload.message, {
      maxLength: LIMITS.message,
      required: true,
      multiline: true,
      requiredMessage: brief ? "Please describe the project." : "Please enter a message.",
    }),
  );

  const service = brief ? take("service", checkService(payload.service)) : null;
  const budget = brief ? take("budget", checkBudget(payload.budget)) : null;
  const timeline = brief ? take("timeline", checkTimeline(payload.timeline)) : null;
  const links = brief
    ? take("links", cleanText(payload.links, { maxLength: LIMITS.links, multiline: true }))
    : null;
  const company = brief ? take("company", cleanText(payload.company, { maxLength: LIMITS.company })) : null;

  const projectReference =
    kind === "revision"
      ? take(
          "projectReference",
          cleanText(payload.projectReference, {
            maxLength: LIMITS.projectReference,
            required: true,
            requiredMessage: "Please enter the project or order name.",
          }),
        )
      : null;

  let call: CallSlot | null = null;
  if (kind === "call") {
    const zoneText = take(
      "timeZone",
      cleanText(payload.timeZone, {
        maxLength: 64,
        required: true,
        requiredMessage: "Please choose a time zone.",
      }),
    );
    const timeZone = zoneText !== null && isTimeZone(zoneText) ? zoneText : null;
    if (zoneText !== null && !timeZone) errors.timeZone = "Please choose a valid time zone.";
    const dateText = take(
      "date",
      cleanText(payload.date, { maxLength: 32, required: true, requiredMessage: "Please choose a date." }),
    );
    const date = dateText === null ? null : take("date", checkCallDate(dateText, timeZone ?? "UTC", at));
    const timeText = take(
      "time",
      cleanText(payload.time, { maxLength: 32, required: true, requiredMessage: "Please choose a time." }),
    );
    const time = timeText !== null && TIME_PATTERN.test(timeText) ? timeText : null;
    if (timeText !== null && !time) errors.time = "Please use the 24-hour HH:MM time format.";
    const duration = take("duration", checkDuration(payload.duration));
    if (timeZone && date && time && duration !== null) call = { timeZone, date, time, duration };
  }

  if (Object.keys(errors).length > 0 || !kind) return { ok: false, errors };
  return {
    ok: true,
    data: {
      kind,
      name: name!,
      email: email!,
      contact,
      company,
      service,
      subject: subject!,
      message: message!,
      budget,
      timeline,
      links,
      projectReference,
      call,
      aiOptOut: checkBoolean(payload.aiOptOut),
    },
  };
}
