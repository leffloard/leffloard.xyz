import { BankAccountsForm, ProfileForm } from "@/components/admin/billing/settings-forms";
import { PageHeader } from "@/components/admin/shell";
import { requireAdmin } from "@/server/auth/dal";
import { paymentsAvailable } from "@/server/billing/providers";
import { getBillingSettings } from "@/server/billing/settings";
import { getDb } from "@/server/db/client";

export const metadata = { title: "Billing settings" };

export default async function BillingSettingsPage() {
  await requireAdmin();
  const settings = await getBillingSettings(await getDb());
  const { crypto } = paymentsAvailable();
  return (
    <>
      <PageHeader
        title="Billing settings"
        description="Issued documents keep the details they were issued with; changes apply to new ones."
      />
      <div className="grid gap-6">
        <ProfileForm
          cryptoReady={crypto}
          initial={{
            version: settings.version,
            documentLabel: settings.documentLabel,
            business: {
              name: settings.business.name,
              address: settings.business.address,
              email: settings.business.email,
              taxId: settings.business.taxId ?? "",
              note: settings.business.note,
            },
            paymentTermsDays: String(settings.paymentTermsDays),
            quoteValidityDays: String(settings.quoteValidityDays),
            methods: settings.methods,
            baseCurrency: settings.baseCurrency,
          }}
        />
        <BankAccountsForm
          version={settings.version}
          initial={settings.bankAccounts.map((account) => ({
            id: account.id,
            label: account.label,
            holder: account.holder,
            bankName: account.bankName,
            iban: account.iban,
            swift: account.swift ?? "",
            currency: account.currency ?? "any",
          }))}
        />
      </div>
    </>
  );
}
