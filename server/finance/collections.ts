import "server-only";
import type { Db } from "mongodb";
import type { ExpenseDoc, RatesDoc } from "@/server/finance/types";

export function expenses(db: Db) {
  return db.collection<ExpenseDoc>("expenses");
}
export function fxRates(db: Db) {
  return db.collection<RatesDoc>("fx_rates");
}
