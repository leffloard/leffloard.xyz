import type { Metadata } from "next";
import Link from "next/link";
import { ManageMeeting } from "@/components/site/booking/manage-meeting";
import { PageIntro, Section } from "@/components/site/section";
import { site } from "@/content/site";
import { guestCanChange } from "@/server/calendar/booking";
import { findMeetingByToken } from "@/server/calendar/meetings";
import { getDb } from "@/server/db/client";

// A guest's link to their meeting. The address is the key, so the page is never indexed or cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your meeting",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function MeetingPage({ params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  const meeting = await findMeetingByToken(await getDb(), token);

  if (!meeting) {
    return (
      <>
        <PageIntro
          label="Your meeting"
          title="This link doesn't work."
          intro="It may have been copied incompletely. The full link is in the email you got when you booked."
        />
        <Section>
          <p className="text-muted">
            Still stuck? Email{" "}
            <a href={`mailto:${site.email}`} className="text-ink underline underline-offset-4">
              {site.email}
            </a>{" "}
            or{" "}
            <Link href="/book" className="text-ink underline underline-offset-4">
              book a new time
            </Link>
            .
          </p>
        </Section>
      </>
    );
  }

  return (
    <>
      <PageIntro label="Your meeting" title={`${meeting.title} with ${site.name}`} />
      <Section>
        <div className="max-w-3xl">
          <ManageMeeting
            token={token}
            meeting={{
              title: meeting.title,
              start: meeting.startsAt.toISOString(),
              durationMinutes: meeting.durationMinutes,
              status: meeting.status,
              guestZone: meeting.timeZone,
              location: meeting.location.url ?? (meeting.location.details || null),
              canChange: guestCanChange(meeting),
            }}
          />
          <p className="mt-8 text-sm text-muted">
            Questions? Reply to the confirmation email, or write to{" "}
            <a href={`mailto:${site.email}`} className="text-ink underline underline-offset-4">
              {site.email}
            </a>
            .
          </p>
        </div>
      </Section>
    </>
  );
}
