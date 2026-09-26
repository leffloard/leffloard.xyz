import "server-only";
import type { Db } from "mongodb";
import type {
  BillingSettingsDoc,
  InvoiceDoc,
  PaymentDoc,
  QuoteDoc,
  RecurringInvoiceDoc,
} from "@/server/billing/types";

// The billing collections, in one place so the stores do not import each other for them.

export function billingSettings(db: Db) {
  return db.collection<BillingSettingsDoc>("settings");
}
export function quotes(db: Db) {
  return db.collection<QuoteDoc>("quotes");
}
export function invoices(db: Db) {
  return db.collection<InvoiceDoc>("invoices");
}
export function payments(db: Db) {
  return db.collection<PaymentDoc>("payments");
}
export function counters(db: Db) {
  return db.collection<{ _id: string; seq: number }>("counters");
}
export function recurringInvoices(db: Db) {
  return db.collection<RecurringInvoiceDoc>("recurring_invoices");
}
