import { ExportForm } from "@/components/admin/finance/finance-controls";
import { PageHeader } from "@/components/admin/shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { todayIn } from "@/lib/intake/time";
import { requireAdmin } from "@/server/auth/dal";
import { getBillingSettings } from "@/server/billing/settings";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";

export const metadata = { title: "Export for the accountant" };

export default async function ExportPage() {
  await requireAdmin();
  const settings = await getBillingSettings(await getDb());
  const today = todayIn(ADMIN_TIME_ZONE, now());
  return (
    <>
      <PageHeader
        title="Export for the accountant"
        description="Every payment, refund and expense in a span of days, as a spreadsheet."
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardBody>
            <ExportForm from={`${today.slice(0, 4)}-01-01`} to={today} />
          </CardBody>
        </Card>
        <Card className="self-start">
          <CardHeader title="What's in it" />
          <CardBody className="grid gap-3 text-[13px] text-muted">
            <p>
              One row per movement: its date, type, document number, client or supplier, method and reference.
              Money in is positive, refunds and expenses negative.
            </p>
            <p>
              Each amount also comes in {settings.baseCurrency}, with TCMB&apos;s rate and the bulletin it was
              taken from, so it can be checked.
            </p>
            <p>It holds your clients&apos; payments: you&apos;ll be asked to confirm it&apos;s you.</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
