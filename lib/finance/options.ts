import { daysBetween } from "@/lib/work/dates";

// Expense categories and the receivables' age groups, with the words the admin shows.

export const EXPENSE_CATEGORIES = [
  "software",
  "hosting",
  "hardware",
  "ai",
  "fees",
  "contractors",
  "education",
  "marketing",
  "office",
  "taxes",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  software: "Software and subscriptions",
  hosting: "Hosting and domains",
  hardware: "Hardware",
  ai: "AI usage",
  fees: "Bank and payment fees",
  contractors: "Contractors",
  education: "Courses and books",
  marketing: "Marketing",
  office: "Office and internet",
  taxes: "Taxes and official fees",
  other: "Other",
};

export const AGING_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_LABELS: Record<AgingBucket, string> = {
  current: "Not due yet",
  "1-30": "1–30 days late",
  "31-60": "31–60 days late",
  "61-90": "61–90 days late",
  "90+": "Over 90 days late",
};

// How late an unpaid invoice is. One without a due date counts as not due.
export function agingBucket(dueDate: string | null, today: string): AgingBucket {
  const late = dueDate ? daysBetween(dueDate, today) : 0;
  if (late <= 0) return "current";
  if (late <= 30) return "1-30";
  if (late <= 60) return "31-60";
  if (late <= 90) return "61-90";
  return "90+";
}
