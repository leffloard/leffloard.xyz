import Link from "next/link";
import { NewMeetingForm } from "@/components/admin/calendar/new-meeting-form";
import { PageHeader } from "@/components/admin/shell";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { isCalendarDate, timeZoneNames, todayIn } from "@/lib/intake/time";
import { requireAdmin } from "@/server/auth/dal";
import { clientChoices } from "@/server/clients/store";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { channelStatus } from "@/server/notify/channels";
import { parseId } from "@/server/work/collections";

export const metadata = { title: "New meeting" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewMeetingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const raw = await searchParams;
  const clients = await clientChoices(await getDb());
  const client = parseId(first(raw.client))?.toHexString() ?? "";
  const date = first(raw.date);
  return (
    <>
      <div className="mb-4">
        <Link
          href="/admin/calendar"
          className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          ← Calendar
        </Link>
      </div>
      <PageHeader title="New meeting" description="Set up a call yourself: it is confirmed straight away." />
      <NewMeetingForm
        clients={clients.map((choice) => ({
          id: choice.id,
          label: choice.company ? `${choice.name} (${choice.company})` : choice.name,
        }))}
        defaults={{
          clientId: clients.some((choice) => choice.id === client) ? client : "",
          date: date && isCalendarDate(date) ? date : todayIn(ADMIN_TIME_ZONE, now()),
          title: "Project call",
        }}
        canEmail={channelStatus().clientEmail}
        timeZones={timeZoneNames()}
      />
    </>
  );
}
