import { z } from "zod";
import { emailSchema, notesText, requiredText } from "@/lib/forms";
import { CURRENCIES, MAX_AMOUNT_MINOR } from "@/lib/money";

// The client portal's forms, read the same way in the browser and on the server.

export const signInSchema = z.object({
  email: emailSchema.refine((value) => value !== null, "Enter the email address you work with me from."),
});

export const revisionRequestSchema = z.object({
  projectId: z.string().regex(/^[a-f0-9]{24}$/, "Unknown project."),
  title: requiredText(120, "Say in a few words what should change."),
  details: notesText(4000),
  chargeAgreed: z.boolean(),
  // The extra-round price the client saw when they ticked the box (null: none was set).
  agreedPrice: z
    .object({
      amountMinor: z.number().int().min(0).max(MAX_AMOUNT_MINOR),
      currency: z.enum(CURRENCIES),
    })
    .strict()
    .nullable()
    .default(null),
});

export const dataRequestSchema = z.object({
  kind: z.enum(["export", "erase"]),
  note: notesText(1000),
});
