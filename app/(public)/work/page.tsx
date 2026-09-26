import type { Metadata } from "next";
import { CtaBand } from "@/components/site/cta-band";
import { PageIntro, Section } from "@/components/site/section";
import { WorkCard } from "@/components/site/work-card";
import { work } from "@/content/work";

export const metadata: Metadata = {
  title: "Work",
  description:
    "Case studies of websites, Discord bots, apps and tools I've built, with the problem, the approach and the stack.",
  alternates: { canonical: "/work" },
};

export default function WorkPage() {
  const featured = work.filter((item) => item.featured);
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
      <Section id="more" index="02" label="More projects">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {rest.map((item) => (
            <WorkCard key={item.slug} item={item} className="reveal min-h-[16rem]" />
          ))}
        </div>
      </Section>
      <CtaBand />
    </>
  );
}
