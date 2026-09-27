import type { Metadata } from "next";
import Link from "next/link";
import { Availability } from "@/components/site/availability";
import { PageIntro, Section } from "@/components/site/section";
import { site } from "@/content/site";
import { listBookingTypes } from "@/server/calendar/booking-types";
import { getDb } from "@/server/db/client";

export const metadata: Metadata = {
  title: "Book a call",
  description: "Pick a time for a video call about your project, in your own time zone.",
  alternates: { canonical: "/book" },
};

// Rendered per request: booking types change in the admin.
export const dynamic = "force-dynamic";

const LOCATIONS = { jitsi: "Video call in the browser", discord: "On Discord", custom: "" } as const;

export default async function BookPage() {
  const types = await listBookingTypes(await getDb(), { publicOnly: true });
  return (
    <>
      <PageIntro
        label="Book a call"
        title="Talk it through."
        intro="Pick a time that suits you; the times are shown in your own time zone. Calls are in English or Turkish."
      >
        <div className="rise mt-10" style={{ "--delay": "240ms" } as React.CSSProperties}>
          <Availability />
        </div>
      </PageIntro>
      <Section id="types" index="01" label="Choose a call">
        {types.length ? (
          <ul className="grid gap-4 md:grid-cols-2">
            {types.map((type) => (
              <li key={type.slug}>
                <Link
                  href={`/book/${type.slug}`}
                  className="group grid h-full gap-3 rounded-3xl border border-line bg-surface p-6 transition-colors hover:border-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:p-8"
                >
                  <span className="flex items-baseline justify-between gap-4">
                    <span className="text-xl font-semibold tracking-tight">{type.title}</span>
                    <span className="shrink-0 font-mono text-sm text-muted">{type.durationMinutes} min</span>
                  </span>
                  {type.description ? <span className="text-muted">{type.description}</span> : null}
                  <span className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-muted">
                      {LOCATIONS[type.location.kind] || type.location.details}
                    </span>
                    <span className="font-medium text-accent">
                      Pick a time <span aria-hidden>→</span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">
            No calls can be booked online at the moment.{" "}
            <Link href="/contact" className="underline">
              Write to me
            </Link>{" "}
            and we&apos;ll find a time.
          </p>
        )}
        <p className="mt-8 text-sm text-muted">
          Prefer to write first? Use the{" "}
          <Link href="/contact" className="text-ink underline underline-offset-4">
            contact form
          </Link>{" "}
          or email{" "}
          <a href={`mailto:${site.email}`} className="text-ink underline underline-offset-4">
            {site.email}
          </a>
          .
        </p>
      </Section>
    </>
  );
}
