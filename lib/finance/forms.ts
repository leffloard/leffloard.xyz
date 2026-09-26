import { z } from "zod";
import { readAmount } from "@/lib/billing/forms";
import { CSV_FORMATS } from "@/lib/finance/csv";
import { EXPENSE_CATEGORIES } from "@/lib/finance/options";
import { dateSchema, optionalIdSchema, requiredText, text } from "@/lib/forms";
import { CURRENCIES } from "@/lib/money";

// The finance forms: an expense, and the accountant's export.

export const expenseSchema = z.object({
  id: z.string().regex(/^(?:[a-f0-9]{24})?$/),
  version: z.number().int().min(0),
  date: dateSchema.refine((value) => value !== null, "Choose the day it was paid."),
  amount: readAmount("Enter the amount.").refine(
    (value) => value !== null && value > 0,
    "Enter an amount above zero.",
  ),
  currency: z.enum(CURRENCIES),
  category: z.enum(EXPENSE_CATEGORIES),
  vendor: requiredText(200, "Who was paid?"),
  description: text({ maxLength: 500 }).transform((value) => value ?? ""),
  reference: text({ maxLength: 120 }).transform((value) => value ?? ""),
  projectId: optionalIdSchema,
});

export const exportSchema = z
  .object({
    from: dateSchema.refine((value) => value !== null, "Choose the first day."),
    to: dateSchema.refine((value) => value !== null, "Choose the last day."),
    format: z.enum(CSV_FORMATS),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "The last day comes after the first.",
    path: ["to"],
  });
