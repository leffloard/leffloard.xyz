import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingFlow } from "@/components/site/booking/booking-flow";
import { PageIntro, Section } from "@/components/site/section";
import { site } from "@/content/site";
import { bookableType } from "@/server/calendar/booking-types";
import { openSlots } from "@/server/calendar/meetings";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";

// Rendered per request: open times change all the time, and the bot check's key comes from the server.
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// A secret type's link carries its key (?key=...).
async function typeFor({ params, searchParams }: Props) {
  const key = (await searchParams).key;
  return bookableType(await getDb(), (await params).slug, typeof key === "string" ? key : null);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const type = await typeFor(props);
  if (!type) return { title: "Book a call" };
  return {
    title: `Book: ${type.title}`,
    description: type.description || "Pick a time for a call, in your own time zone.",
    // A secret type is shared by link only.
    robots: type.visibility !== "public" ? { index: false, follow: false } : undefined,
    alternates: type.visibility === "public" ? { canonical: `/book/${type.slug}` } : undefined,
  };
}

const LOCATIONS = {
  jitsi:
    "A video call in the browser (Jitsi Meet): no account or app needed. The link comes with the confirmation.",
  discord: "On Discord.",
  custom: "",
} as const;

export default async function BookTypePage(props: Props) {
  const type = await typeFor(props);
  if (!type) notFound();
  const { slots, rules } = await openSlots(await getDb(), type.durationMinutes);

  return (
    <>
      <PageIntro label="Book a call" title={type.title} intro={type.description || undefined} />
      <Section id="book" index="01" label="Booking">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <BookingFlow
              type={{
                slug: type.slug,
                linkKey: type.visibility !== "public" ? type.linkKey : null,
                title: type.title,
                durationMinutes: type.durationMinutes,
                requiresApproval: type.requiresApproval,
                questions: type.questions,
              }}
              initialSlots={slots.map((slot) => slot.toISOString())}
              ownerZone={rules.timeZone}
              ownerEmail={site.email}
              turnstileSiteKey={getEnv().TURNSTILE_SITE_KEY}
              nonce={(await headers()).get("x-nonce") ?? undefined}
            />
          </div>
          <aside className="grid content-start gap-6 lg:col-span-4">
            <dl className="grid gap-4 text-[15px]">
              <div className="border-b border-line pb-4">
                <dt className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">Length</dt>
                <dd className="mt-1">{type.durationMinutes} minutes</dd>
              </div>
              <div className="border-b border-line pb-4">
                <dt className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">Where</dt>
                <dd className="mt-1">{LOCATIONS[type.location.kind] || type.location.details}</dd>
              </div>
              <div className="border-b border-line pb-4">
                <dt className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">Confirmation</dt>
                <dd className="mt-1">
                  {type.requiresApproval
                    ? "I confirm each request by email, usually within a day."
                    : "Straight away, by email, with a calendar invite."}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">Changes</dt>
                <dd className="mt-1">
                  Reschedule or cancel any time before the call, from the link in the email.
                </dd>
              </div>
            </dl>
            <p className="text-sm text-muted">
              Other calls:{" "}
              <Link href="/book" className="text-ink underline underline-offset-4">
                all booking options
              </Link>
              .
            </p>
          </aside>
        </div>
      </Section>
    </>
  );
}
