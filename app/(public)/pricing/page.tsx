import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand } from "@/components/site/cta-band";
import { Faq } from "@/components/site/faq";
import { Arrow } from "@/components/site/link-button";
import { PageIntro, Section } from "@/components/site/section";
import { formatPrice } from "@/components/site/service-card";
import { pageContent } from "@/server/content/site";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Starting prices for websites, web apps, Discord bots, authentication and desktop software, plus payment terms and methods.",
  alternates: { canonical: "/pricing" },
};

export default async function PricingPage() {
  const { services, pricing } = await pageContent();
  return (
    <>
      <PageIntro
        label="Pricing"
        title="Starting prices, in plain numbers."
        intro="Every project gets a fixed quote. These are the floors, so you can tell early whether we are in the same range."
      />
      <Section id="prices" index="01" label="Packages">
        <div className="grid gap-10">
          {services.map((service) => (
            <div key={service.slug} className="reveal grid gap-4 md:grid-cols-12">
              <div className="md:col-span-3">
                <h2 className="text-lg font-semibold tracking-tight">{service.title}</h2>
                <Link
                  href={`/services/${service.slug}`}
                  className="group mt-1 inline-flex items-center gap-1.5 text-sm text-accent"
                >
                  Details <Arrow />
                </Link>
              </div>
              <div className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3 md:col-span-9">
                {service.packages.map((item) => (
                  <div key={item.name} className="bg-canvas p-5">
                    <p className="flex items-center gap-2 text-[15px] font-medium">
                      {item.name}
                      {item.highlighted ? (
                        <>
                          <span aria-hidden className="size-1.5 rounded-full bg-accent" />
                          <span className="sr-only">(most chosen)</span>
                        </>
                      ) : null}
                    </p>
                    <p className="mt-2">
                      <span className="text-sm text-muted">from </span>
                      <span className="text-2xl font-semibold tracking-tight">{formatPrice(item.price)}</span>
                    </p>
                    <p className="mt-2 text-sm text-muted">{item.summary}</p>
                    <p className="mt-3 font-mono text-xs text-muted">
                      {item.timeline} · {item.revisions ?? "–"} revision{" "}
                      {item.revisions === 1 ? "round" : "rounds"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-8 text-sm text-muted">
          Prices in US dollars. Turkish clients are quoted and invoiced in lira.
        </p>
      </Section>

      <Section id="terms" index="02" label="Terms" title="How payment works.">
        <div className="grid gap-4 md:grid-cols-3">
          {pricing.paymentTerms.map((term) => (
            <div key={term.title} className="reveal rounded-2xl border border-line p-6">
              <p className="font-mono text-xs text-accent">{term.title}</p>
              <p className="mt-3 text-lg">{term.text}</p>
            </div>
          ))}
        </div>
        <ul className="prose-list mt-10 max-w-3xl">
          {pricing.terms.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Section>

      <Section id="methods" index="03" label="Payment methods">
        <ul className="grid gap-4 md:grid-cols-3">
          {pricing.paymentMethods.map((method) => (
            <li key={method.name} className="rounded-2xl border border-line p-6">
              <p className="text-lg font-semibold">{method.name}</p>
              <p className="mt-2 text-[15px] text-muted">{method.note}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="faq" index="04" label="Questions">
        <Faq items={pricing.faq} />
      </Section>
      <CtaBand />
    </>
  );
}
