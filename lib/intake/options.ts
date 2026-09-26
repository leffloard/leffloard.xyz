// The choices the contact form offers, and how the inbox names things. Shared by the form, the server and
// the admin, so a value accepted in one place is understood everywhere.

export const INQUIRY_KINDS = ["brief", "question", "revision", "call"] as const;
export type InquiryKind = (typeof INQUIRY_KINDS)[number];

export const KIND_LABELS: Record<InquiryKind, string> = {
  brief: "Project brief",
  question: "Question",
  revision: "Revision request",
  call: "Call request",
};

export const INQUIRY_STATUSES = ["new", "open", "confirmed", "done", "declined", "spam"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export const STATUS_LABELS: Record<InquiryStatus, string> = {
  new: "New",
  open: "Open",
  confirmed: "Confirmed",
  done: "Done",
  declined: "Declined",
  spam: "Spam",
};

// Matches the slugs in content/services.ts (a unit test keeps them in step), plus "other".
export const SERVICE_OPTIONS = [
  { value: "websites", label: "Websites & web apps" },
  { value: "discord-bots", label: "Discord bots" },
  { value: "auth-and-licensing", label: "Auth & licensing" },
  { value: "desktop-software", label: "Desktop software" },
  { value: "other", label: "Something else" },
] as const;

// The v1 form's service names, mapped to today's services.
export const LEGACY_SERVICES: Record<string, string> = {
  "Web Development": "websites",
  "Discord Bot": "discord-bots",
  "Authentication System": "auth-and-licensing",
  "Loader / Desktop App": "desktop-software",
  Other: "other",
};

export const BUDGET_OPTIONS = [
  { value: "under-500", label: "Under $500" },
  { value: "500-1500", label: "$500 to $1,500" },
  { value: "1500-3000", label: "$1,500 to $3,000" },
  { value: "3000-10000", label: "$3,000 to $10,000" },
  { value: "over-10000", label: "Over $10,000" },
  { value: "not-sure", label: "Not sure yet" },
] as const;

export const TIMELINE_OPTIONS = [
  { value: "asap", label: "As soon as possible" },
  { value: "1-month", label: "Within a month" },
  { value: "1-3-months", label: "In one to three months" },
  { value: "flexible", label: "Flexible" },
] as const;

export const CALL_DURATIONS = [15, 30, 45, 60] as const;
export const DEFAULT_CALL_DURATION = 30;
export const MAX_DAYS_AHEAD = 120;

export function optionLabel(
  options: readonly { value: string; label: string }[],
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return options.find((option) => option.value === value)?.label ?? value;
}
