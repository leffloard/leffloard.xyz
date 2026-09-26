import type { Metadata } from "next";
import { Availability } from "@/components/site/availability";
import { ContactForm } from "@/components/site/contact-form";
import { Arrow, LinkButton } from "@/components/site/link-button";
import { PageIntro, Section } from "@/components/site/section";
import { site } from "@/content/site";
import { getEnv } from "@/server/env";

export const metadata: Metadata = {
  title: "Contact",
  description: "Tell me about your project, ask a question or request a call.",
  alternates: { canonical: "/contact" },
};

// Rendered per request: the bot check's site key is read from the server's configuration.
export const dynamic = "force-dynamic";

const include = [
  "What you want to build, and the problem it solves",
  "Who will use it, and roughly how many people",
  "Any deadline, and why it matters",
  "A budget range, even a rough one",
  "Links: your current site, examples you like, documents",
];

const next = [
  { title: "I read it and reply", text: "With questions, a rough range, or an honest “not a fit”." },
  {
    title: "A short call if useful",
    text: "Voice or video, in English or Turkish, when the details need it.",
  },
  { title: "A written quote", text: "Scope, fixed price, milestones and timeline, valid for 14 days." },
];

export default function ContactPage() {
  const subject = encodeURIComponent("Project inquiry");
  return (
    <>
      <PageIntro
        label="Contact"
        title="Tell me about your project."
        intro="A few sentences are enough to start. Use the form below, or email me directly."
      >
        <div
          className="rise mt-10 flex flex-wrap items-center gap-4"
          style={{ "--delay": "240ms" } as React.CSSProperties}
        >
          <LinkButton href="#write" variant="primary">
            Write to me <Arrow />
          </LinkButton>
          <LinkButton href="/book" variant="secondary">
            Book a call
          </LinkButton>
          <LinkButton href={`mailto:${site.email}?subject=${subject}`} variant="secondary">
            {site.email}
          </LinkButton>
          <Availability />
        </div>
      </PageIntro>
      <Section id="write" index="01" label="Write to me">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <ContactForm email={site.email} turnstileSiteKey={getEnv().TURNSTILE_SITE_KEY} />
          </div>
          <aside className="lg:col-span-4">
            <h3 className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">Worth including</h3>
            <ol className="mt-4 grid gap-3">
              {include.map((line, index) => (
                <li key={line} className="flex gap-3 border-b border-line pb-3 text-[15px]">
                  <span className="w-6 shrink-0 font-mono text-sm text-accent">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {line}
                </li>
              ))}
            </ol>
          </aside>
        </div>
      </Section>
      <Section id="next" index="02" label="What happens next">
        <div className="grid gap-4 md:grid-cols-3">
          {next.map((step) => (
            <div key={step.title} className="reveal rounded-2xl border border-line p-6">
              <h3 className="text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 text-muted">{step.text}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-sm text-muted">
          I&apos;m in {site.location} ({site.timeZoneLabel}).
        </p>
      </Section>
    </>
  );
}
