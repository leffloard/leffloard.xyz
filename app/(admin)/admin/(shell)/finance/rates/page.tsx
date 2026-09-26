import { RefreshRatesButton } from "@/components/admin/finance/finance-controls";
import { PageHeader } from "@/components/admin/shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatRate, RATE_CURRENCIES } from "@/lib/finance/fx";
import { formatDateTime } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { longDate } from "@/server/billing/view";
import { getDb } from "@/server/db/client";
import { recentBulletins } from "@/server/finance/rates";
import { jobs } from "@/server/jobs/runner";

export const metadata = { title: "Exchange rates" };

export default async function RatesPage() {
  await requireAdmin();
  const db = await getDb();
  const [bulletins, job] = await Promise.all([
    recentBulletins(db, 30),
    jobs(db).findOne({ _id: "fx-rates" }),
  ]);
  return (
    <>
      <PageHeader
        title="Exchange rates"
        description="TCMB's forex buying rates, which put every currency in the reports into one."
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader title="The latest bulletins" description="Lira per unit." />
          {bulletins.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th scope="col" className="px-5 py-2 font-normal">
                      Bulletin
                    </th>
                    {RATE_CURRENCIES.map((currency) => (
                      <th key={currency} scope="col" className="px-5 py-2 text-right font-normal">
                        {currency}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {bulletins.map((bulletin) => (
                    <tr key={bulletin.date}>
                      <th scope="row" className="px-5 py-2 text-left font-normal">
                        {longDate(bulletin.date)}
                      </th>
                      {RATE_CURRENCIES.map((currency) => (
                        <td key={currency} className="px-5 py-2 text-right font-mono tabular-nums">
                          {bulletin.rates[currency] ? formatRate(bulletin.rates[currency]) : "–"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <CardBody>
              <p className="text-[13px] text-muted">
                No rates yet. Fetch them now, or wait for the next run.
              </p>
            </CardBody>
          )}
        </Card>
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader title="How they're used" />
            <CardBody className="grid gap-3 text-[13px] text-muted">
              <p>
                A day&apos;s payments and expenses use the bulletin of the last business day before it: TCMB
                announces the rates at 15:30 for the next day, which is also how Turkish bookkeeping values
                amounts in other currencies.
              </p>
              <p>
                They&apos;re fetched each morning and after 15:30. Days a payment needs are filled in from
                TCMB&apos;s archive. An amount without a rate is left out of the totals in lira and listed on
                the overview, never guessed.
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Last run" />
            <CardBody className="grid gap-3 text-[13px]">
              <p className={job?.lastOk === false ? "text-danger" : "text-muted"}>
                {job?.lastFinishedAt
                  ? `${formatDateTime(job.lastFinishedAt)}: ${job.lastMessage ?? ""}`
                  : "Not run yet."}
              </p>
              <RefreshRatesButton />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
