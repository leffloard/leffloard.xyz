"use server";

import { ObjectId } from "mongodb";
import { refresh } from "next/cache";
import { z } from "zod";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { MAX_MONTHLY_BUDGET_MICROS, MICROS_PER_CENT, monthLabel } from "@/lib/ai/budget";
import { formatUsd } from "@/lib/ai/pricing";
import { aiSettingsForm, type QuoteSuggestion } from "@/lib/ai/schemas";
import { CURRENCIES, formatMoney, money, parseAmount } from "@/lib/money";
import { draftQuote, triageInquiry } from "@/server/ai/inbox";
import { saveAiSettings } from "@/server/ai/settings";
import { checkConnection, recordMonthExpense } from "@/server/ai/usage";
import { adminAction } from "@/server/auth/action";
import { audit } from "@/server/auth/audit";

const objectId = z.string().regex(/^[a-f0-9]{24}$/, "Unknown item.");

function invalidField(field: string, message: string): ActionResult<never> {
  return {
    ok: false,
    error: "Check the highlighted fields.",
    code: "invalid",
    fieldErrors: { [field]: message },
  };
}

// --- Settings ----------------------------------------------------------------------------------------------

export const saveAiSettingsAction = adminAction(aiSettingsForm, async (input, { db, user, client }) => {
  const budget = parseAmount(input.budget);
  if (!budget.ok) return invalidField("budget", budget.message);
  if (budget.minor === null) return invalidField("budget", "Set a monthly budget, such as 15.");
  const monthlyBudgetMicros = budget.minor * MICROS_PER_CENT;
  if (monthlyBudgetMicros > MAX_MONTHLY_BUDGET_MICROS) {
    return invalidField("budget", `At most ${formatUsd(MAX_MONTHLY_BUDGET_MICROS)} a month.`);
  }
  const saved = await saveAiSettings(
    db,
    {
      enabled: input.enabled,
      model: input.model,
      monthlyBudgetMicros,
      fallbacks: input.fallbacks,
      autoTriage: input.autoTriage,
    },
    input.version,
  );
  if (!saved.ok) return fail("The settings were changed in another tab. Reload to see them.");
  await audit(db, {
    action: "ai.settings.changed",
    actorId: user._id,
    ip: client.ip,
    userAgent: client.userAgent,
    details: {
      enabled: input.enabled,
      model: input.model,
      budget: formatUsd(monthlyBudgetMicros),
      fallbacks: input.fallbacks,
      autoTriage: input.autoTriage,
    },
  });
  refresh();
  return ok(
    { version: saved.settings.version },
    input.enabled ? "Saved. The AI assistant is on." : "Saved. The AI assistant is off.",
  );
});

export const checkAiConnectionAction = adminAction(z.object({}), async (_input, { db }) => {
  const result = await checkConnection(db);
  if (!result.ok) return fail(result.message);
  return ok(null, `The key works: ${result.name} (${result.model}) is available.`);
});

export const recordAiExpenseAction = adminAction(
  z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, "Unknown month.") }),
  async (input, { db }) => {
    const result = await recordMonthExpense(db, input.month);
    if (!result.ok) {
      const reasons = {
        current: "This month isn't over yet.",
        missing: "There was no AI usage that month.",
        empty: "Nothing was spent that month.",
        recorded: "That month is already in the expenses.",
      } as const;
      return fail(reasons[result.reason]);
    }
    refresh();
    return ok(
      null,
      `Added ${formatMoney(money(result.amountMinor, "USD"))} for ${monthLabel(input.month)} to the expenses. Match it to Anthropic's invoice there.`,
    );
  },
);

// --- Features with a structured answer ---------------------------------------------------------------------

export const triageInquiryAction = adminAction(z.object({ inquiryId: objectId }), async (input, { db }) => {
  const result = await triageInquiry(db, new ObjectId(input.inquiryId));
  if (!result.ok) return fail(result.message);
  refresh();
  return ok(null, "Triaged. These are suggestions: nothing was changed.");
});

export const quoteDraftAction = adminAction(
  z.object({ inquiryId: objectId, currency: z.enum(CURRENCIES) }),
  async (input, { db }): Promise<ActionResult<QuoteSuggestion>> => {
    const result = await draftQuote(db, new ObjectId(input.inquiryId), input.currency);
    if (!result.ok) return fail(result.message);
    return ok(
      result.suggestion,
      `Draft filled in (${formatUsd(result.costMicros)}). Check every line and price before saving.`,
    );
  },
);
