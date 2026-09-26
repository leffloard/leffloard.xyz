import Link from "next/link";
import { PageHeader } from "@/components/admin/shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { invoices } from "@/server/billing/collections";
import { paymentRows } from "@/server/billing/payment-rows";
import { paymentsToReview, recentPayments } from "@/server/billing/payments";
import type { PaymentDoc } from "@/server/billing/types";
import { getDb } from "@/server/db/client";

export const metadata = { title: "Payments" };

type EventRow = {
  _id: string;
  receivedAt: Date;
  signatureOk: boolean;
  status: string | null;
  outcome: string;
  detail: string | null;
};

export default async function PaymentsPage() {
  await requireAdmin();
  const db = await getDb();
  const [review, recent, events] = await Promise.all([
    paymentsToReview(db),
    recentPayments(db, 30),
    db.collection<EventRow>("payment_events").find().sort({ receivedAt: -1 }).limit(20).toArray(),
  ]);
  const numbers = new Map(
    (
      await invoices(db)
        .find(
          { _id: { $in: [...review, ...recent].map((payment) => payment.invoiceId) } },
          { projection: { number: 1, title: 1 } },
        )
        .toArray()
    ).map((invoice) => [invoice._id.toHexString(), `${invoice.number} · ${invoice.title}`]),
  );
  const list = (docs: PaymentDoc[], empty: string) =>
    docs.length ? (
      <ul className="divide-y divide-line">
        {paymentRows(docs).map((row, index) => {
          const invoiceId = docs[index]!.invoiceId.toHexString();
          return (
            <li key={row.id} className="grid gap-1 px-5 py-3 text-[13px]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link
                  href={`/admin/billing/invoices/${invoiceId}`}
                  className="min-w-0 flex-1 truncate font-medium hover:text-accent"
                >
                  {numbers.get(invoiceId) ?? "Invoice"}
                </Link>
                <span className="font-mono tabular-nums">{row.amount}</span>
                <span className="text-muted">{row.method}</span>
                <Badge
                  tone={
                    row.status === "review" ? "warning" : row.status === "confirmed" ? "success" : "neutral"
                  }
                >
                  {row.statusLabel}
                </Badge>
                <span className="w-40 text-right text-xs text-muted">{row.when}</span>
              </div>
              {row.detail ? <p className="text-xs break-words text-muted">{row.detail}</p> : null}
            </li>
          );
        })}
      </ul>
    ) : (
      <CardBody>
        <p className="text-[13px] text-muted">{empty}</p>
      </CardBody>
    );

  return (
    <>
      <PageHeader title="Payments" description="What arrived, and what needs your eyes." />
      <div className="grid gap-6">
        <Card>
          <CardHeader
            title="Needs your review"
            description="Part payments, amounts that don't match, money for an invoice that was no longer open. Open the invoice to decide."
          />
          {list(review, "Nothing to review.")}
        </Card>
        <Card>
          <CardHeader title="Received" description="The latest 30." />
          {list(recent, "No payments yet.")}
        </Card>
        <Card>
          <CardHeader
            title="NOWPayments callbacks"
            description="The latest 20, each checked for its signature before anything is done."
          />
          {events.length ? (
            <ul className="divide-y divide-line">
              {events.map((event) => (
                <li
                  key={event._id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-[13px]"
                >
                  <span className="w-40 text-xs text-muted">{formatDateTime(event.receivedAt)}</span>
                  <span className="font-mono text-xs">{event.status ?? "?"}</span>
                  <Badge tone={event.signatureOk ? "neutral" : "danger"}>
                    {event.signatureOk ? "signed" : "bad signature"}
                  </Badge>
                  <span className="text-muted">{event.outcome}</span>
                  {event.detail ? (
                    <span className="min-w-0 flex-1 truncate text-xs text-muted">{event.detail}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <CardBody>
              <p className="text-[13px] text-muted">None yet.</p>
            </CardBody>
          )}
        </Card>
      </div>
    </>
  );
}
