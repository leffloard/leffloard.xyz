import Link from "next/link";
import { ExpenseForm } from "@/components/admin/finance/expense-form";
import { PageHeader } from "@/components/admin/shell";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { todayIn } from "@/lib/intake/time";
import { requireAdmin } from "@/server/auth/dal";
import { billingProjects } from "@/server/billing/lookups";
import { getBillingSettings } from "@/server/billing/settings";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";

export const metadata = { title: "New expense" };

export default async function NewExpensePage() {
  await requireAdmin();
  const db = await getDb();
  const [projects, settings] = await Promise.all([billingProjects(db), getBillingSettings(db)]);
  return (
    <>
      <div className="mb-4">
        <Link
          href="/admin/finance/expenses"
          className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          ← Expenses
        </Link>
      </div>
      <PageHeader title="Add an expense" />
      <ExpenseForm
        id={null}
        version={0}
        projects={projects}
        initial={{
          date: todayIn(ADMIN_TIME_ZONE, now()),
          amount: "",
          currency: settings.baseCurrency,
          category: "software",
          vendor: "",
          description: "",
          reference: "",
          projectId: "",
        }}
      />
    </>
  );
}
