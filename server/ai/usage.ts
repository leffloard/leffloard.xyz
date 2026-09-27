import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { ObjectId, type Db } from "mongodb";
import { lastDayOf, MICROS_PER_CENT, monthKey, monthLabel } from "@/lib/ai/budget";
import { now } from "@/server/clock";
import { aiMonths } from "@/server/ai/collections";
import { anthropicClient } from "@/server/ai/client";
import { getMonth } from "@/server/ai/ledger";
import { getAiSettings } from "@/server/ai/settings";
import { inTransaction } from "@/server/db/transaction";
import { expenses } from "@/server/finance/collections";
import type { ExpenseDoc } from "@/server/finance/types";

// The usage page's actions: checking the key, and putting a month's AI spending into the expenses.

export type ConnectionCheck = { ok: true; model: string; name: string } | { ok: false; message: string };

// Asks Anthropic about the chosen model: proves the key works and the model is available, without using
// any tokens.
export async function checkConnection(db: Db): Promise<ConnectionCheck> {
  const client = anthropicClient();
  if (!client) return { ok: false, message: "ANTHROPIC_API_KEY is not set on the server." };
  const { model } = await getAiSettings(db);
  try {
    const info = await client.models.retrieve(model);
    return { ok: true, model: info.id, name: info.display_name };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return { ok: false, message: "Anthropic refused the API key. Check ANTHROPIC_API_KEY." };
    }
    if (error instanceof Anthropic.NotFoundError) {
      return { ok: false, message: `${model} isn't available to this API key.` };
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return { ok: false, message: "Anthropic could not be reached from the server." };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, message: `Anthropic answered with an error (${error.status ?? "no status"}).` };
    }
    throw error;
  }
}

export type RecordedExpense =
  | { ok: true; expenseId: ObjectId; amountMinor: number }
  | { ok: false; reason: "current" | "missing" | "empty" | "recorded" };

// A finished month's estimated AI spending as an expense (category "AI usage", in US dollars, dated the
// month's last day), once. The owner corrects the amount from Anthropic's invoice if it differs.
export async function recordMonthExpense(db: Db, month: string, at: Date = now()): Promise<RecordedExpense> {
  if (month >= monthKey(at)) return { ok: false, reason: "current" };
  const doc = await getMonth(db, month);
  if (!doc) return { ok: false, reason: "missing" };
  if (doc.expenseId) return { ok: false, reason: "recorded" };
  const amountMinor = Math.ceil(doc.spentMicros / MICROS_PER_CENT);
  if (amountMinor <= 0) return { ok: false, reason: "empty" };
  return inTransaction(db, async (session) => {
    const expense: ExpenseDoc = {
      _id: new ObjectId(),
      date: lastDayOf(month),
      amountMinor,
      currency: "USD",
      category: "ai",
      vendor: "Anthropic",
      description: `Claude API usage, ${monthLabel(month)} (the site's estimate)`,
      reference: `AI-${month}`,
      projectId: null,
      version: 1,
      createdAt: at,
      updatedAt: at,
    };
    const claimed = await aiMonths(db).updateOne(
      { _id: month, expenseId: null },
      { $set: { expenseId: expense._id, updatedAt: at } },
      { session },
    );
    if (claimed.modifiedCount !== 1) return { ok: false, reason: "recorded" } as const;
    await expenses(db).insertOne(expense, { session });
    return { ok: true, expenseId: expense._id, amountMinor } as const;
  });
}
