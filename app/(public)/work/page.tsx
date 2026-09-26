import type { Metadata } from "next";
import { CtaBand } from "@/components/site/cta-band";
import { PageIntro, Section } from "@/components/site/section";
import { RepoList } from "@/components/site/repo-list";
import { WorkCard } from "@/components/site/work-card";
import { pageContent } from "@/server/content/site";

export const metadata: Metadata = {
  title: "Work",
  description:
    "Case studies of websites, Discord bots, apps and tools I've built, with the problem, the approach and the stack.",
  alternates: { canonical: "/work" },
};

export default async function WorkPage() {
  const { work, repos } = await pageContent();
  const featured = work.filter((item) => item.featured);
  const linked = new Set(work.map((item) => item.repo?.toLowerCase()).filter(Boolean));
  const openSource = repos.filter((repo) => !linked.has(repo.url.toLowerCase()));
  const rest = work.filter((item) => !item.featured);
  return (
    <>
      <PageIntro
        label="Work"
        title="Projects, with the reasoning behind them."
        intro="Open-source projects link to their code. Private work is described without code, customer names or numbers I cannot show."
      />
      <Section id="featured" index="01" label="Featured">
        <div className="grid gap-4 md:grid-cols-2">
          {featured.map((item, index) => (
            <WorkCard
              key={item.slug}
              item={item}
              large={index === 0}
              className={`reveal ${index === 0 ? "min-h-[22rem] md:col-span-2" : "min-h-[18rem]"}`}
            />
          ))}
        </div>
      </Section>
      {rest.length ? (
        <Section id="more" index="02" label="More projects">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {rest.map((item) => (
              <WorkCard key={item.slug} item={item} className="reveal min-h-[16rem]" />
            ))}
          </div>
        </Section>
      ) : null}
      {openSource.length ? (
        <Section
          id="open-source"
          index={rest.length ? "03" : "02"}
          label="Open source"
          title="Smaller things on GitHub."
          intro="Public repositories without a case study of their own, straight from GitHub."
        >
          <RepoList repos={openSource} />
        </Section>
      ) : null}
      <CtaBand />
    </>
  );
}
