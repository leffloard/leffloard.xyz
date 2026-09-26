import { CtaBand } from "@/components/site/cta-band";
import { Arrow, LinkButton } from "@/components/site/link-button";
import { PostList } from "@/components/site/post-list";
import { Section } from "@/components/site/section";
import { ServiceCard } from "@/components/site/service-card";
import { SignalField } from "@/components/site/signal-field";
import { Availability } from "@/components/site/availability";
import { WorkCard } from "@/components/site/work-card";
import { services } from "@/content/services";
import { process, site } from "@/content/site";
import { publicRepoCount, work } from "@/content/work";
import { listPosts } from "@/server/content/posts";

const delay = (ms: number) => ({ "--delay": `${ms}ms` }) as React.CSSProperties;

export default async function HomePage() {
  const featured = work.filter((item) => item.featured);
  const posts = (await listPosts()).slice(0, 3);
  const proof = [
    { value: String(site.since), label: "Freelancing since" },
    { value: String(work.length), label: "Projects on this site" },
    { value: String(publicRepoCount), label: "Open-source repositories" },
    { value: site.timeZoneLabel, label: `${site.location}, remote` },
  ];

  const person = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: site.name,
    jobTitle: site.role,
    url: site.origin,
    email: `mailto:${site.email}`,
    address: { "@type": "PostalAddress", addressLocality: "Denizli", addressCountry: "TR" },
    sameAs: [site.github],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(person).replace(/</g, "\\u003c") }}
      />
      <div className="relative overflow-hidden">
        <SignalField className="absolute inset-0 h-full w-full [mask-image:radial-gradient(75%_85%_at_70%_40%,black,transparent)]" />
        <div className="relative px-5 pt-20 pb-16 sm:px-10 sm:pt-28 sm:pb-24">
          <div className="rise flex flex-wrap items-center gap-3">
            <Availability />
            <span className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">
              {site.role} · {site.location}
            </span>
          </div>
          <h1 className="mt-8 max-w-5xl text-[clamp(2.9rem,9vw,7.4rem)] leading-[0.92] font-semibold tracking-[-0.045em] text-balance">
            <span className="rise block" style={delay(80)}>
              Software that
            </span>
            <span className="rise block text-muted" style={delay(180)}>
              holds up.
            </span>
          </h1>
          <p
            className="rise mt-8 max-w-2xl text-lg leading-relaxed text-pretty text-muted sm:text-xl"
            style={delay(300)}
          >
            I&apos;m {site.firstName}, an independent developer in {site.location}. Since {site.since}{" "}
            I&apos;ve built websites, web apps, Discord bots and sign-in systems: tested, documented, and
            yours to keep.
          </p>
          <div className="rise mt-10 flex flex-wrap items-center gap-3" style={delay(420)}>
            <LinkButton href="/contact">
              Start a project <Arrow />
            </LinkButton>
            <LinkButton href="/work" variant="secondary">
              See the work
            </LinkButton>
          </div>
        </div>
        <dl
          className="fade-in relative grid grid-cols-2 border-t border-line md:grid-cols-4"
          style={delay(600)}
        >
          {proof.map((item, index) => (
            <div
              key={item.label}
              className={`flex flex-col px-5 py-6 sm:px-10 ${index % 2 === 1 ? "border-l border-line" : ""} ${index >= 2 ? "border-t border-line md:border-t-0" : ""} ${index === 2 ? "md:border-l" : ""}`}
            >
              <dt className="order-2 mt-1 text-xs text-muted">{item.label}</dt>
              <dd className="order-1 font-mono text-2xl font-medium tracking-tight">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <Section
        id="work"
        index="01"
        label="Selected work"
        title="Things I've built, and how."
        intro="Each project has a short case study: the problem, the approach, and the decisions that mattered."
        action={
          <LinkButton href="/work" variant="secondary" size="sm">
            All work <Arrow />
          </LinkButton>
        }
      >
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

      <Section
        id="services"
        index="02"
        label="Services"
        title="Four kinds of work, one standard."
        intro="Fixed quotes, clear milestones, and code that belongs to you."
        action={
          <LinkButton href="/pricing" variant="secondary" size="sm">
            Pricing <Arrow />
          </LinkButton>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {services.map((service, index) => (
            <div key={service.slug} className="reveal">
              <ServiceCard service={service} index={index} />
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="process"
        index="03"
        label="How I work"
        title="From first message to launch, without surprises."
      >
        <ol className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-4">
          {process.map((step, index) => (
            <li key={step.title} className="reveal bg-canvas p-6 sm:p-7">
              <span className="font-mono text-xs text-accent">{String(index + 1).padStart(2, "0")}</span>
              <h3 className="mt-6 text-lg font-semibold tracking-tight">{step.title}</h3>
              <p className="mt-2 text-[15px] text-pretty text-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      {posts.length > 0 ? (
        <Section
          id="writing"
          index="04"
          label="Writing"
          title="Notes from the work."
          action={
            <LinkButton href="/blog" variant="secondary" size="sm">
              All posts <Arrow />
            </LinkButton>
          }
        >
          <PostList posts={posts} />
        </Section>
      ) : null}

      <CtaBand />
    </>
  );
}
