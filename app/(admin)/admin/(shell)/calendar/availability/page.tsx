import Link from "next/link";
import { AvailabilityEditor } from "@/components/admin/calendar/availability-editor";
import { FeedCard } from "@/components/admin/calendar/feed-card";
import { PageHeader } from "@/components/admin/shell";
import { timeZoneNames } from "@/lib/intake/time";
import { requireAdmin } from "@/server/auth/dal";
import { getCalendarSettings } from "@/server/calendar/settings";
import { getDb } from "@/server/db/client";

export const metadata = { title: "Hours and rules" };

export default async function AvailabilityPage() {
  await requireAdmin();
  const settings = await getCalendarSettings(await getDb());
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
      <PageHeader
        title="Hours and rules"
        description="What the booking page offers. Meetings already booked stay as they are."
      />
      <div className="grid gap-6">
        <AvailabilityEditor
          initial={{
            version: settings.version,
            timeZone: settings.timeZone,
            weekly: settings.weekly,
            overrides: settings.overrides,
            bufferMinutes: settings.bufferMinutes,
            stepMinutes: settings.stepMinutes,
            minNoticeHours: Math.round(settings.minNoticeMinutes / 60),
            horizonDays: settings.horizonDays,
            dailyCap: settings.dailyCap,
          }}
          timeZones={timeZoneNames()}
        />
        <FeedCard enabled={settings.feedEnabled} />
      </div>
    </>
  );
}
