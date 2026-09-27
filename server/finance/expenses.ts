import "server-only";
import { ObjectId, type Db } from "mongodb";
import type { ExpenseCategory } from "@/lib/finance/options";
import type { Currency } from "@/lib/money";
import { now } from "@/server/clock";
import { expenses } from "@/server/finance/collections";
import type { ExpenseDoc } from "@/server/finance/types";

// What the business spends. Saved with a version, so two tabs cannot silently undo each other.

export type ExpenseInput = {
  date: string;
  amountMinor: number;
  currency: Currency;
  category: ExpenseCategory;
  vendor: string;
  description: string;
  reference: string;
  projectId: ObjectId | null;
};

export type ExpenseChange = { ok: true; expense: ExpenseDoc } | { ok: false; reason: "missing" | "conflict" };

export async function createExpense(db: Db, input: ExpenseInput, at: Date = now()): Promise<ExpenseDoc> {
  const doc: ExpenseDoc = { _id: new ObjectId(), ...input, version: 1, createdAt: at, updatedAt: at };
  await expenses(db).insertOne(doc);
  return doc;
}

export async function updateExpense(
  db: Db,
  id: ObjectId,
  version: number,
  input: ExpenseInput,
  at: Date = now(),
): Promise<ExpenseChange> {
  const updated = await expenses(db).findOneAndUpdate(
    { _id: id, version },
    { $set: { ...input, updatedAt: at }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
  if (updated) return { ok: true, expense: updated };
  return { ok: false, reason: (await expenses(db).countDocuments({ _id: id })) ? "conflict" : "missing" };
}

export async function deleteExpense(db: Db, id: ObjectId): Promise<boolean> {
  return (await expenses(db).deleteOne({ _id: id })).deletedCount === 1;
}

export async function getExpense(db: Db, id: ObjectId): Promise<ExpenseDoc | null> {
  return expenses(db).findOne({ _id: id });
}

// A month's expenses ("2026-09"), or the latest ones; newest first.
export async function listExpenses(
  db: Db,
  { month, category }: { month?: string | null; category?: ExpenseCategory | null } = {},
): Promise<ExpenseDoc[]> {
  return expenses(db)
    .find({
      ...(month ? { date: { $gte: `${month}-01`, $lte: `${month}-31` } } : {}),
      ...(category ? { category } : {}),
    })
    .sort({ date: -1, createdAt: -1 })
    .limit(month ? 1000 : 200)
    .toArray();
}

// The months that have expenses, newest first ("2026-09").
export async function expenseMonths(db: Db): Promise<string[]> {
  const rows = await expenses(db)
    .aggregate<{ _id: string }>([
      { $group: { _id: { $substrBytes: ["$date", 0, 7] } } },
      { $sort: { _id: -1 } },
    ])
    .toArray();
  return rows.map((row) => row._id);
}

export async function expensesForProject(db: Db, projectId: ObjectId): Promise<ExpenseDoc[]> {
  return expenses(db).find({ projectId }).sort({ date: -1 }).limit(200).toArray();
}
