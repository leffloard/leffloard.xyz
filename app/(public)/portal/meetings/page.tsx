import type { Metadata } from "next";
import { PageIntro, Section } from "@/components/site/section";
import { Badge } from "@/components/ui/badge";
import { describeMoment } from "@/lib/intake/time";
import { bookingPath } from "@/server/calendar/booking-types";
import { readableManageToken } from "@/server/calendar/meetings";
import { getDb } from "@/server/db/client";
import { requirePortalClient } from "@/server/portal/dal";
import { portalBookingTypes, portalMeetings } from "@/server/portal/views";

export const metadata: Metadata = { title: "Calls" };

const card = "rounded-3xl border border-line bg-surface p-6";

export default async function PortalMeetingsPage() {
  const { client } = await requirePortalClient();
  const db = await getDb();
  const [calls, types] = await Promise.all([portalMeetings(db, client._id), portalBookingTypes(db)]);
  return (
    <>
      <PageIntro
        label="Client portal"
        title="Calls"
        intro="Your calls with me, and a time for the next one."
      />
      <Section label="Book" title="Book a call">
        {types.length ? (
          <ul className="grid gap-4 md:grid-cols-2">
            {types.map((type) => (
              <li key={type._id.toHexString()} className={card}>
                <p className="font-medium">{type.title}</p>
                <p className="mt-1 text-sm text-muted">
                  {type.durationMinutes} minutes{type.description ? ` · ${type.description}` : ""}
                </p>
                <a
                  href={bookingPath(type)}
                  className="mt-4 inline-block text-sm text-ink underline underline-offset-4"
                >
                  Pick a time
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">
            Booking is closed for now: reply to my last email and we&apos;ll find a time.
          </p>
        )}
      </Section>
      <Section label="Calls" title="Coming up">
        {calls.upcoming.length ? (
          <ul className="grid gap-4">
            {calls.upcoming
              .map((call) => ({ call, manageToken: readableManageToken(call) }))
              .map(({ call, manageToken }) => (
                <li key={call._id.toHexString()} className={card}>
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {call.title}
                    {call.status === "requested" ? <Badge>waiting for my confirmation</Badge> : null}
                  </p>
                  <p className="mt-1 text-muted">{describeMoment(call.startsAt, call.timeZone)}</p>
                  <div className="mt-4 flex flex-wrap gap-4 text-sm">
                    {call.location.url && call.status === "confirmed" ? (
                      <a href={call.location.url} className="text-ink underline underline-offset-4">
                        Join the call
                      </a>
                    ) : null}
                    {manageToken ? (
                      <a
                        href={`/meeting/${manageToken}`}
                        className="text-muted underline underline-offset-4 hover:text-ink"
                      >
                        Move or cancel it
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-muted">No calls coming up.</p>
        )}
      </Section>
      {calls.past.length ? (
        <Section label="Past" title="Earlier calls">
          <ul className="grid gap-2 text-sm">
            {calls.past.map((call) => (
              <li key={call._id.toHexString()}>
                {call.title} ·{" "}
                <span className="text-muted">{describeMoment(call.startsAt, call.timeZone)}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}
