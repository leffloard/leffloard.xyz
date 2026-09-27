"use server";

import { ObjectId } from "mongodb";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fail, ok } from "@/lib/action-result";
import { exportSchema, expenseSchema } from "@/lib/finance/forms";
import { fieldError, idSchema } from "@/lib/forms";
import { adminAction } from "@/server/auth/action";
import { audit } from "@/server/auth/audit";
import { getBillingSettings } from "@/server/billing/settings";
import { createExpense, deleteExpense, updateExpense, type ExpenseInput } from "@/server/finance/expenses";
import { describeRefresh, refreshRates, RatesUnavailableError } from "@/server/finance/rates";
import { financeCsv } from "@/server/finance/report";
import { getProject } from "@/server/projects/store";

const PROBLEMS = {
  missing: "This expense no longer exists.",
  conflict: "This expense was changed somewhere else. Reload to see it.",
} as const;

export const saveExpenseAction = adminAction(expenseSchema, async (input, { db }) => {
  const projectId = input.projectId ? new ObjectId(input.projectId) : null;
  if (projectId && !(await getProject(db, projectId)))
    return fieldError("projectId", "That project no longer exists.");
  const expense: ExpenseInput = {
    date: input.date!,
    amountMinor: input.amount!,
    currency: input.currency,
    category: input.category,
    vendor: input.vendor,
    description: input.description,
    reference: input.reference,
    projectId,
  };
  if (input.id) {
    const saved = await updateExpense(db, new ObjectId(input.id), input.version, expense);
    if (!saved.ok) return fail(PROBLEMS[saved.reason]);
    refresh();
    return ok(null, "Saved.");
  }
  await createExpense(db, expense);
  redirect(`/admin/finance/expenses?month=${expense.date.slice(0, 7)}`);
});

export const deleteExpenseAction = adminAction(z.object({ id: idSchema }), async (input, { db }) => {
  if (!(await deleteExpense(db, new ObjectId(input.id)))) return fail(PROBLEMS.missing);
  redirect("/admin/finance/expenses");
});

// TCMB's latest bulletin, and older ones the books still need, right now.
export const refreshRatesAction = adminAction(z.object({}), async (_input, { db }) => {
  try {
    const result = await refreshRates(db);
    refresh();
    return ok(null, `Done: ${describeRefresh(result)}.`);
  } catch (error) {
    if (error instanceof RatesUnavailableError) return fail(`${error.message} Try again later.`);
    throw error;
  }
});

// The accountant's CSV. It holds every client's payments, so it asks to confirm it's you and is logged.
export const exportFinanceAction = adminAction(
  exportSchema,
  async (input, { db, user, client }) => {
    const settings = await getBillingSettings(db);
    const result = await financeCsv(db, {
      from: input.from!,
      to: input.to!,
      base: settings.baseCurrency,
      format: input.format,
    });
    await audit(db, {
      action: "finance.exported",
      actorId: user._id,
      ip: client.ip,
      userAgent: client.userAgent,
      details: { from: input.from, to: input.to, rows: result.rows },
    });
    return ok(
      {
        filename: `leffloard-finance-${input.from}-to-${input.to}.csv`,
        csv: result.csv,
        rows: result.rows,
        missing: result.missing,
      },
      result.rows
        ? `${result.rows} rows.${result.missing ? ` ${result.missing} have no exchange rate yet.` : ""}`
        : "Nothing in those days.",
    );
  },
  { sudo: true },
);
