import type { ObjectId } from "mongodb";
import type { Rates } from "@/lib/finance/fx";
import type { ExpenseCategory } from "@/lib/finance/options";
import type { Currency } from "@/lib/money";

// Finance: what the business spends, and the exchange rates that put every currency in one.

export type ExpenseDoc = {
  _id: ObjectId;
  date: string; // YYYY-MM-DD, the day it was paid
  amountMinor: number;
  currency: Currency;
  category: ExpenseCategory;
  vendor: string; // who was paid
  description: string;
  reference: string; // the receipt's or invoice's number
  projectId: ObjectId | null; // spent for a project
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

// One TCMB bulletin, under its date. `rates` is null for a day without one (weekends, holidays), so the
// archive isn't asked again.
export type RatesDoc = {
  _id: string; // YYYY-MM-DD
  source: "TCMB";
  rates: Rates | null;
  fetchedAt: Date;
};
