import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CtaBand } from "@/components/site/cta-band";
import { Arrow } from "@/components/site/link-button";
import { Testimonials } from "@/components/site/testimonials";
import { findWork, formatPostDate } from "@/lib/content/types";
import { pageContent } from "@/server/content/site";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const item = findWork(await pageContent(), (await params).slug);
  if (!item) return {};
  return {
    title: item.title,
    description: item.summary,
    alternates: { canonical: `/work/${item.slug}` },
    openGraph: { title: item.title, description: item.summary, url: `/work/${item.slug}`, type: "article" },
  };
}

export default async function CaseStudyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { work, testimonials, repoStats } = await pageContent();
  const item = findWork({ work }, (await params).slug);
  if (!item) notFound();
  const quotes = testimonials.filter((quote) => quote.workSlug === item.slug);
  const stats = item.repo ? repoStats[item.repo.toLowerCase()] : undefined;
  const index = work.indexOf(item);
  const next = work[(index + 1) % work.length]!;
  const facts = [
    { label: "Year", value: item.year },
    { label: "Type", value: item.kind },
    { label: "Area", value: item.category },
    { label: "Status", value: item.status },
  ];

  return (
    <article>
      <header className="relative px-5 pt-16 pb-14 sm:px-10 sm:pt-24 sm:pb-20">
        <Link
          href="/work"
          className="rise inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] text-muted uppercase hover:text-ink"
        >
          <Arrow className="rotate-180" /> Work
        </Link>
        <h1
          className="rise mt-6 max-w-4xl text-4xl leading-[1.02] font-semibold tracking-[-0.03em] text-balance sm:text-6xl"
          style={{ "--delay": "80ms" } as React.CSSProperties}
        >
          {item.title}
        </h1>
        <p
          className="rise mt-6 max-w-2xl text-xl text-pretty text-muted"
          style={{ "--delay": "160ms" } as React.CSSProperties}
        >
          {item.tagline}
        </p>
      </header>

      <div className="relative grid gap-12 border-t border-line px-5 py-14 sm:px-10 md:grid-cols-12">
        <span aria-hidden className="crosshair top-0 left-0" />
        <span aria-hidden className="crosshair top-0 left-full" />
        <aside className="md:col-span-4">
          <dl className="grid gap-5 md:sticky md:top-24">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">{fact.label}</dt>
                <dd className="mt-1 text-[15px]">{fact.value}</dd>
              </div>
            ))}
            <div>
              <dt className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">Stack</dt>
              <dd className="mt-2">
                <ul className="flex flex-wrap gap-1.5">
                  {item.stack.map((tech) => (
                    <li
                      key={tech}
                      className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted"
                    >
                      {tech}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">Code</dt>
              <dd className="mt-1 text-[15px]">
                {item.repo ? (
                  <a
                    href={item.repo}
                    rel="noopener noreferrer"
                    className="text-accent underline-offset-4 hover:underline"
                  >
                    {item.repo.replace("https://", "")}
                  </a>
                ) : (
                  <span className="text-muted">Private repository</span>
                )}
                {stats ? (
                  <span className="mt-1 block font-mono text-xs text-muted">
                    <span aria-hidden>★ </span>
                    {stats.stars} {stats.stars === 1 ? "star" : "stars"}
                    {stats.pushedAt ? ` · updated ${formatPostDate(stats.pushedAt)}` : ""}
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>
        </aside>

        <div className="md:col-span-8">
          <p className="text-xl leading-relaxed text-pretty">{item.summary}</p>
          {item.lead ? (
            // Sanitized when it was saved (server/content/render.ts).
            <div className="prose mt-8" dangerouslySetInnerHTML={{ __html: item.lead }} />
          ) : null}
          {item.sections.map((section, sectionIndex) => (
            <section key={section.id} className="reveal mt-14" aria-labelledby={section.id}>
              <p className="font-mono text-[11px] tracking-[0.14em] text-accent uppercase">
                {String(sectionIndex + 1).padStart(2, "0")}
              </p>
              <h2 id={section.id} className="mt-2 text-2xl font-semibold tracking-tight">
                {section.heading}
              </h2>
              <div className="prose mt-4" dangerouslySetInnerHTML={{ __html: section.html }} />
            </section>
          ))}
          {quotes.length ? (
            <section className="mt-14" aria-label="What the client said">
              <Testimonials items={quotes} />
            </section>
          ) : null}
        </div>
      </div>

      <nav aria-label="Next project" className="relative border-t border-line">
        <span aria-hidden className="crosshair top-0 left-0" />
        <span aria-hidden className="crosshair top-0 left-full" />
        <Link
          href={`/work/${next.slug}`}
          className="group flex flex-wrap items-end justify-between gap-6 px-5 py-14 sm:px-10"
        >
          <span>
            <span className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">Next project</span>
            <span className="mt-3 block text-3xl font-semibold tracking-tight group-hover:text-accent sm:text-4xl">
              {next.title}
            </span>
            <span className="mt-2 block max-w-xl text-muted">{next.tagline}</span>
          </span>
          <Arrow className="size-6 text-muted group-hover:text-ink" />
        </Link>
      </nav>
      <CtaBand />
    </article>
  );
}
