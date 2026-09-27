import { TabNav } from "@/components/admin/tab-nav";

// The billing section's tabs. Each page below still checks the session itself.
export default function BillingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TabNav
        label="Billing"
        tabs={[
          { href: "/admin/billing", label: "Overview" },
          { href: "/admin/billing/quotes", label: "Quotes" },
          { href: "/admin/billing/invoices", label: "Invoices" },
          { href: "/admin/billing/recurring", label: "Recurring" },
          { href: "/admin/billing/payments", label: "Payments" },
          { href: "/admin/billing/settings", label: "Settings" },
        ]}
      />
      {children}
    </>
  );
}
