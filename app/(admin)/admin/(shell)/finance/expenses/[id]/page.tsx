import Link from "next/link";
import { notFound } from "next/navigation";
import { ExpenseForm } from "@/components/admin/finance/expense-form";
import { PageHeader } from "@/components/admin/shell";
import { amountInput, money } from "@/lib/money";
import { requireAdmin } from "@/server/auth/dal";
import { billingProjects } from "@/server/billing/lookups";
import { getDb } from "@/server/db/client";
import { getExpense } from "@/server/finance/expenses";
import { parseId } from "@/server/work/collections";

export const metadata = { title: "Expense" };

export default async function ExpensePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = parseId((await params).id);
  const db = await getDb();
  const expense = id ? await getExpense(db, id) : null;
  if (!expense) notFound();
  const projects = await billingProjects(db);
  return (
    <>
      <div className="mb-4">
        <Link
          href={`/admin/finance/expenses?month=${expense.date.slice(0, 7)}`}
          className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          ← Expenses
        </Link>
      </div>
      <PageHeader title={`${expense.vendor}`} description={expense.description || undefined} />
      <ExpenseForm
        id={expense._id.toHexString()}
        version={expense.version}
        projects={projects}
        initial={{
          date: expense.date,
          amount: amountInput(money(expense.amountMinor, expense.currency)),
          currency: expense.currency,
          category: expense.category,
          vendor: expense.vendor,
          description: expense.description,
          reference: expense.reference,
          projectId: expense.projectId?.toHexString() ?? "",
        }}
      />
    </>
  );
}
