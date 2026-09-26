import type { Metadata } from "next";
import Link from "next/link";
import { LinkButton } from "@/components/site/link-button";
import { PrintButton } from "@/components/site/print-button";
import { cv } from "@/content/cv";
import { site } from "@/content/site";
import { findWork, work } from "@/content/work";

export const metadata: Metadata = {
  title: "CV",
  description: `CV of ${site.name}, ${cv.headline.toLowerCase()} in ${site.location}.`,
  alternates: { canonical: "/cv" },
};

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-line py-8 md:grid-cols-12 print:break-inside-avoid">
      <h2 className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase md:col-span-3 md:pt-1">
        {title}
      </h2>
      <div className="md:col-span-9">{children}</div>
    </section>
  );
}

export default function CvPage() {
  const featured = work.filter((item) => item.featured);
  return (
    <article className="px-5 py-16 sm:px-10 sm:py-24 print:p-0">
      <header className="grid gap-6 pb-10 md:grid-cols-12">
        <div className="md:col-span-8">
          <p className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase print:hidden">
            Curriculum vitae
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl print:mt-0">{site.name}</h1>
          <p className="mt-2 text-xl text-muted">{cv.headline}</p>
        </div>
        <ul className="grid content-start gap-1 text-[15px] md:col-span-4 md:text-right">
          <li>
            <a href={`mailto:${site.email}`} className="hover:text-accent">
              {site.email}
            </a>
          </li>
          <li>
            <a href={site.github} rel="noopener noreferrer" className="hover:text-accent">
              github.com/{site.handle}
            </a>
          </li>
          <li>
            <a href={site.origin} className="hover:text-accent">
              {site.origin.replace("https://", "")}
            </a>
          </li>
          <li className="text-muted">{site.location} · remote</li>
        </ul>
        <div className="flex flex-wrap gap-3 md:col-span-12 print:hidden">
          <LinkButton href="/cv.pdf" size="sm">
            Download PDF
          </LinkButton>
          <PrintButton />
        </div>
      </header>

      <Block title="Summary">
        <p className="max-w-3xl text-lg text-pretty">{cv.summary}</p>
      </Block>

      <Block title="Experience">
        {cv.experience.map((job) => (
          <div key={job.role}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg font-semibold">{job.role}</h3>
              <p className="font-mono text-sm text-muted">{job.period}</p>
            </div>
            <p className="text-muted">{job.place}</p>
            <ul className="prose-list mt-3">
              {job.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
        ))}
      </Block>

      <Block title="Selected projects">
        <ul className="grid gap-4">
          {featured.map((item) => (
            <li key={item.slug}>
              <Link href={`/work/${item.slug}`} className="font-semibold hover:text-accent">
                {item.title}
              </Link>
              <span className="text-muted"> · {item.year}</span>
              <p className="text-muted">{item.tagline}</p>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Skills">
        <dl className="grid gap-4">
          {cv.skills.map((skill) => (
            <div key={skill.group} className="grid gap-1 sm:grid-cols-[10rem_1fr]">
              <dt className="font-medium">{skill.group}</dt>
              <dd>
                <span>{skill.items.join(", ")}</span>
                <span className="block text-sm text-muted print:hidden">
                  Seen in{" "}
                  {skill.proof.map((slug, index) => (
                    <span key={slug}>
                      {index > 0 ? ", " : ""}
                      <Link
                        href={`/work/${slug}`}
                        className="underline-offset-4 hover:text-accent hover:underline"
                      >
                        {findWork(slug)?.title ?? slug}
                      </Link>
                    </span>
                  ))}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </Block>

      <Block title="Education">
        {cv.education.map((entry) => (
          <p key={entry.place}>
            <span className="font-semibold">{entry.place}</span>
            <span className="text-muted"> · {entry.detail}</span>
          </p>
        ))}
      </Block>

      <Block title="Languages">
        <ul className="flex flex-wrap gap-x-8 gap-y-1">
          {cv.languages.map((language) => (
            <li key={language.name}>
              <span className="font-semibold">{language.name}</span>
              <span className="text-muted"> · {language.level}</span>
            </li>
          ))}
        </ul>
      </Block>
    </article>
  );
}
