import { z } from "zod";
import {
  MAX_LINES,
  MAX_TAXES,
  parsePercent,
  parseQuantity,
  SCHEDULES,
  type Discount,
  type ScheduleKey,
} from "@/lib/billing/document";
import { isValidBic, isValidIban, normalizeIban } from "@/lib/billing/iban";
import { DOCUMENT_LABELS, PAYMENT_METHODS } from "@/lib/billing/options";
import { emailSchema, notesText, optionalIdSchema, requiredText, text } from "@/lib/forms";
import { CURRENCIES, parseAmount } from "@/lib/money";

// The admin's billing forms: document lines, discounts, taxes, recipients, bank accounts. Numbers arrive as
// the text the owner typed and are read with the same rules the editor previews with (lib/billing/document).

function readWith(read: (text: string) => { ok: true; value: number } | { ok: false; message: string }) {
  return z
    .string()
    .max(24)
    .transform((value, context) => {
      const parsed = read(value);
      if (!parsed.ok) {
        context.addIssue({ code: "custom", message: parsed.message });
        return z.NEVER;
      }
      return parsed.value;
    });
}

export function readAmount(required: string | null) {
  return z
    .string()
    .max(24)
    .transform((value, context) => {
      const parsed = parseAmount(value);
      if (!parsed.ok) {
        context.addIssue({ code: "custom", message: parsed.message });
        return z.NEVER;
      }
      if (parsed.minor === null && required) {
        context.addIssue({ code: "custom", message: required });
        return z.NEVER;
      }
      return parsed.minor;
    });
}

const localId = z.string().regex(/^[A-Za-z0-9-]{1,64}$/, "Unknown item.");

export const lineSchema = z.object({
  id: localId,
  description: requiredText(2000, "Describe this line.", true),
  quantity: readWith(parseQuantity),
  unitPrice: readAmount("Enter a price.").transform((value) => value!),
});

export const discountSchema = z
  .object({ kind: z.enum(["none", "percent", "amount"]), value: z.string().max(24) })
  .transform((input, context): Discount | null => {
    if (input.kind === "none") return null;
    if (input.kind === "percent") {
      const parsed = parsePercent(input.value);
      if (!parsed.ok) {
        context.addIssue({ code: "custom", message: parsed.message, path: ["value"] });
        return z.NEVER;
      }
      return { kind: "percent", basisPoints: parsed.value };
    }
    const parsed = parseAmount(input.value);
    if (!parsed.ok || parsed.minor === null || parsed.minor === 0) {
      context.addIssue({ code: "custom", message: "Enter the discount, for example 50.", path: ["value"] });
      return z.NEVER;
    }
    return { kind: "amount", amountMinor: parsed.minor };
  });

export const taxSchema = z.object({
  label: requiredText(40, "Name the tax, for example VAT."),
  percent: readWith(parsePercent),
});

export const recipientSchema = z.object({
  name: requiredText(120, "Who is it for?"),
  company: text({ maxLength: 120 }),
  email: emailSchema,
  address: notesText(500),
});

const documentFields = {
  title: requiredText(120, "Give it a title."),
  recipient: recipientSchema,
  currency: z.enum(CURRENCIES),
  lines: z
    .array(lineSchema)
    .min(1, "Add at least one line.")
    .max(MAX_LINES, `Use at most ${MAX_LINES} lines.`),
  discount: discountSchema,
  taxes: z.array(taxSchema).max(MAX_TAXES, `Use at most ${MAX_TAXES} taxes.`),
  notes: notesText(2000),
};

export const SCHEDULE_KEYS = Object.keys(SCHEDULES) as ScheduleKey[];

export const quoteSchema = z.object({
  ...documentFields,
  clientId: z.string().regex(/^[a-f0-9]{24}$/, "Choose the client."),
  inquiryId: optionalIdSchema,
  schedule: z.enum(SCHEDULE_KEYS as [ScheduleKey, ...ScheduleKey[]]),
  timeline: text({ maxLength: 120 }),
  revisionsIncluded: z.coerce
    .number("Enter a number of rounds.")
    .int("Use a whole number.")
    .min(0, "Use 0 or more.")
    .max(20, "At most 20."),
  extraRevisionPrice: readAmount(null),
});

export const invoiceSchema = z.object({
  ...documentFields,
  clientId: optionalIdSchema,
  projectId: optionalIdSchema,
  methods: z.array(z.enum(PAYMENT_METHODS)).max(PAYMENT_METHODS.length),
});

export const bankAccountSchema = z.object({
  id: localId,
  label: requiredText(60, "Name the account, for example Lira account."),
  holder: requiredText(120, "Whose account is it?"),
  bankName: requiredText(120, "Which bank?"),
  iban: z
    .string()
    .max(64)
    .transform((value, context) => {
      const iban = normalizeIban(value);
      if (!isValidIban(iban)) {
        context.addIssue({ code: "custom", message: "This IBAN doesn't check out: look for a typo." });
        return z.NEVER;
      }
      return iban;
    }),
  swift: z
    .string()
    .max(20)
    .transform((value, context) => {
      const code = value.trim().toUpperCase();
      if (!code) return null;
      if (!isValidBic(code)) {
        context.addIssue({ code: "custom", message: "Use the 8 or 11 character SWIFT (BIC) code." });
        return z.NEVER;
      }
      return code;
    }),
  currency: z.enum([...CURRENCIES, "any"]).transform((value) => (value === "any" ? null : value)),
});

export const billingProfileSchema = z.object({
  version: z.number().int().min(0),
  documentLabel: z.enum(DOCUMENT_LABELS),
  business: z.object({
    name: requiredText(120, "Your name, or your business's."),
    address: notesText(500),
    email: emailSchema.refine((value) => value !== null, "Add the email clients reply to."),
    taxId: text({ maxLength: 40 }),
    note: notesText(300),
  }),
  paymentTermsDays: z.coerce
    .number("Enter a number of days.")
    .int("Use whole days.")
    .min(0)
    .max(90, "At most 90 days."),
  quoteValidityDays: z.coerce
    .number("Enter a number of days.")
    .int("Use whole days.")
    .min(1)
    .max(90, "At most 90 days."),
  methods: z
    .array(z.enum(PAYMENT_METHODS))
    .min(1, "Offer at least one way to pay.")
    .max(PAYMENT_METHODS.length),
  baseCurrency: z.enum(CURRENCIES),
});
