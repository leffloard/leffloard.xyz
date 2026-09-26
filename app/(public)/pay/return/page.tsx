import type { Metadata } from "next";
import Link from "next/link";
import { PageIntro, Section } from "@/components/site/section";
import { formatMoney, money } from "@/lib/money";
import { payments } from "@/server/billing/collections";
import { invoiceByPublicId } from "@/server/billing/invoices";
import { PUBLIC_ID_PATTERN } from "@/server/billing/public-id";
import { getDb } from "@/server/db/client";

// Where NOWPayments sends the client back after paying. The payment itself is confirmed by NOWPayments'
// callback, not by arriving here, so this page only says where things stand.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Payment",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PayReturnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const publicId = first((await searchParams).i) ?? "";
  const db = await getDb();
  const invoice = PUBLIC_ID_PATTERN.test(publicId) ? await invoiceByPublicId(db, publicId) : null;
  if (!invoice) {
    return (
      <PageIntro
        label="Payment"
        title="Thank you."
        intro="If you paid, you'll get a receipt by email once it's confirmed."
      />
    );
  }
  const pending = await payments(db).findOne({
    invoiceId: invoice._id,
    method: "crypto",
    status: { $in: ["pending", "review"] },
  });
  const back = `/i/${invoice.publicId}`;
  const paid = invoice.status === "paid";
  return (
    <>
      <PageIntro
        label={`Payment for ${invoice.number}`}
        title={
          paid
            ? "Paid. Thank you!"
            : pending
              ? "Thank you: it's being confirmed."
              : "No payment has arrived yet."
        }
        intro={
          paid
            ? `${formatMoney(money(invoice.totals.totalMinor, invoice.currency))} received. A receipt is on its way by email.`
            : pending
              ? "The network confirms crypto payments in a few minutes, sometimes longer. You'll get a receipt by email when it's done."
              : "If you just paid, give it a minute and check again."
        }
      />
      <Section>
        <div className="flex flex-wrap gap-4 text-sm">
          <Link href={back} className="text-ink underline underline-offset-4">
            Back to the invoice
          </Link>
          {!paid ? (
            <Link
              href={`/pay/return?i=${invoice.publicId}`}
              className="text-muted underline underline-offset-4 hover:text-ink"
            >
              Check again
            </Link>
          ) : null}
        </div>
      </Section>
    </>
  );
}
