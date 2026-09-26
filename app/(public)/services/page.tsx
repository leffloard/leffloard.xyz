import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand } from "@/components/site/cta-band";
import { Arrow } from "@/components/site/link-button";
import { PageIntro, Section } from "@/components/site/section";
import { formatPrice } from "@/components/site/service-card";
import { services } from "@/content/services";
import { process } from "@/content/site";

export const metadata: Metadata = {
  title: "Services",
  description:
    "Websites and web apps, Discord bots, authentication and licensing, and desktop software, with fixed quotes and clear milestones.",
  alternates: { canonical: "/services" },
};

export default function ServicesPage() {
  return (
    <>
      <PageIntro
        label="Services"
        title="What I build, and how it is priced."
        intro="Four kinds of work. Every project gets a written quote with a fixed price, milestones and a timeline before anything starts."
      />
      {services.map((service, index) => {
        const from = Math.min(...service.packages.map((item) => item.price));
        return (
          <Section
            key={service.slug}
            id={service.slug}
            index={String(index + 1).padStart(2, "0")}
            label={service.title}
          >
            <div className="reveal grid gap-8 md:grid-cols-12">
              <div className="md:col-span-7">
                <h2 className="text-3xl font-semibold tracking-tight text-balance">{service.short}</h2>
                <p className="mt-4 text-lg text-pretty text-muted">{service.intro}</p>
                <Link
                  href={`/services/${service.slug}`}
                  className="group mt-6 inline-flex items-center gap-2 text-sm font-medium text-accent"
                >
                  Packages, add-ons and FAQ <Arrow />
                </Link>
              </div>
              <ul className="grid content-start gap-2 md:col-span-4 md:col-start-9">
                {service.packages.map((item) => (
                  <li
                    key={item.name}
                    className="flex items-baseline justify-between gap-4 border-b border-line pb-2 text-[15px]"
                  >
                    <span>{item.name}</span>
                    <span className="font-mono text-sm text-muted">from {formatPrice(item.price)}</span>
                  </li>
                ))}
                <li className="pt-1 text-xs text-muted">
                  Starting at {formatPrice(from)}. Final price in your quote.
                </li>
              </ul>
            </div>
          </Section>
        );
      })}
      <Section id="process" label="How a project runs" title="The same four steps, whatever the size.">
        <ol className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-4">
          {process.map((step, index) => (
            <li key={step.title} className="bg-canvas p-6">
              <span className="font-mono text-xs text-accent">{String(index + 1).padStart(2, "0")}</span>
              <h3 className="mt-5 font-semibold">{step.title}</h3>
              <p className="mt-2 text-[15px] text-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </Section>
      <CtaBand />
    </>
  );
}
