import { TabNav } from "@/components/admin/tab-nav";

// The finance section's tabs. Each page below still checks the session itself.
export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TabNav
        label="Finance"
        tabs={[
          { href: "/admin/finance", label: "Overview" },
          { href: "/admin/finance/expenses", label: "Expenses" },
          { href: "/admin/finance/rates", label: "Exchange rates" },
          { href: "/admin/finance/export", label: "Export" },
        ]}
      />
      {children}
    </>
  );
}
