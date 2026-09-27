import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CtaBand } from "@/components/site/cta-band";
import { Faq } from "@/components/site/faq";
import { Arrow } from "@/components/site/link-button";
import { PackageCard } from "@/components/site/package-card";
import { PageIntro, Section } from "@/components/site/section";
import { WorkCard } from "@/components/site/work-card";
import { findService, findWork, type WorkItem } from "@/lib/content/types";
import { pageContent } from "@/server/content/site";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const service = findService(await pageContent(), (await params).slug);
  if (!service) return {};
  return {
    title: service.title,
    description: `${service.short} ${service.intro}`,
    alternates: { canonical: `/services/${service.slug}` },
  };
}

export default async function ServicePage({ params }: { params: Promise<{ slug: string }> }) {
  const content = await pageContent();
  const service = findService(content, (await params).slug);
  if (!service) notFound();
  const proof = service.proof
    .map((slug) => findWork(content, slug))
    .filter((item): item is WorkItem => Boolean(item));

  return (
    <>
      <PageIntro label={`Services / ${service.title}`} title={service.short} intro={service.intro}>
        <p
          className="rise mt-6 max-w-2xl text-[15px] text-muted"
          style={{ "--delay": "220ms" } as React.CSSProperties}
        >
          <span className="text-ink">Good fit: </span>
          {service.forWhom}
        </p>
      </PageIntro>
      <Section id="packages" index="01" label="Packages">
        <div className="grid gap-5 pt-3 md:grid-cols-3">
          {service.packages.map((item) => (
            <div key={item.name} className="reveal">
              <PackageCard item={item} />
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-muted">
          Prices in US dollars; Turkish clients are quoted in lira. See{" "}
          <Link href="/pricing#terms" className="text-accent underline underline-offset-4">
            payment terms
          </Link>
          .
        </p>
      </Section>
      <Section id="extras" index="02" label="Add-ons and delivery">
        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <h3 className="text-lg font-semibold">Add-ons</h3>
            <ul className="mt-4 grid gap-2">
              {service.addOns.map((addOn) => (
                <li
                  key={addOn.name}
                  className="flex items-baseline justify-between gap-4 border-b border-line pb-2 text-[15px]"
                >
                  <span>{addOn.name}</span>
                  <span className="shrink-0 font-mono text-sm text-muted">{addOn.price}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-semibold">Every project includes</h3>
            <ul className="prose-list mt-4">
              {service.deliverables.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      </Section>
      {proof.length ? (
        <Section id="proof" index="03" label="Related work">
          <div className="grid gap-4 md:grid-cols-2">
            {proof.map((item) => (
              <WorkCard key={item.slug} item={item} className="reveal min-h-[15rem]" />
            ))}
          </div>
        </Section>
      ) : null}
      <Section id="faq" index="04" label="Questions">
        <Faq items={service.faq} />
        <Link
          href="/pricing#faq"
          className="group mt-6 inline-flex items-center gap-2 text-sm font-medium text-accent"
        >
          More questions on the pricing page <Arrow />
        </Link>
      </Section>
      <CtaBand />
    </>
  );
}
