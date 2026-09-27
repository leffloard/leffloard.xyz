import "server-only";
import type { Db } from "mongodb";
import { site } from "@/content/site";
import { billingSettings } from "@/server/billing/collections";
import type { BankAccount, BillingSettingsDoc } from "@/server/billing/types";
import { now } from "@/server/clock";

// The owner's business details and the defaults of new documents. Saved with a version, so two tabs cannot
// silently undo each other. Bank accounts are saved on their own: changing where money goes asks the owner to
// confirm it's them, and is written to the audit log (see the billing actions).

export type BillingSettings = Omit<BillingSettingsDoc, "_id">;
export type BillingProfile = Omit<BillingSettings, "bankAccounts" | "version" | "updatedAt">;

export const DEFAULT_BILLING: Omit<BillingSettings, "version" | "updatedAt"> = {
  documentLabel: "Payment request",
  business: { name: site.name, address: site.location, email: site.email, taxId: null, note: "" },
  bankAccounts: [],
  paymentTermsDays: 7,
  quoteValidityDays: 14,
  methods: ["bank", "crypto"],
  baseCurrency: "TRY",
};

export async function getBillingSettings(db: Db): Promise<BillingSettings> {
  const doc = await billingSettings(db).findOne<BillingSettings>(
    { _id: "billing" },
    { projection: { _id: 0 } },
  );
  return doc ?? { ...DEFAULT_BILLING, version: 0, updatedAt: new Date(0) };
}

export class StaleBillingError extends Error {
  constructor() {
    super("These settings were changed somewhere else since you opened them. Reload to see them.");
    this.name = "StaleBillingError";
  }
}

async function save(db: Db, change: Partial<BillingSettings>, version: number, at: Date): Promise<void> {
  if (version === 0) {
    const inserted = await billingSettings(db).updateOne(
      { _id: "billing" },
      { $setOnInsert: { ...DEFAULT_BILLING, ...change, version: 1, updatedAt: at } },
      { upsert: true },
    );
    if (inserted.upsertedCount !== 1) throw new StaleBillingError();
    return;
  }
  const updated = await billingSettings(db).updateOne(
    { _id: "billing", version },
    { $set: { ...change, updatedAt: at }, $inc: { version: 1 } },
  );
  if (updated.matchedCount !== 1) throw new StaleBillingError();
}

export async function saveBillingProfile(
  db: Db,
  profile: BillingProfile,
  version: number,
  at: Date = now(),
): Promise<void> {
  await save(db, profile, version, at);
}

export async function saveBankAccounts(
  db: Db,
  accounts: BankAccount[],
  version: number,
  at: Date = now(),
): Promise<void> {
  await save(db, { bankAccounts: accounts }, version, at);
}
