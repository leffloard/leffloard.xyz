import type { Metadata } from "next";
import { CtaBand } from "@/components/site/cta-band";
import { Arrow, LinkButton } from "@/components/site/link-button";
import { ProfilePhoto } from "@/components/site/profile-photo";
import { PageIntro, Section } from "@/components/site/section";
import { site } from "@/content/site";

export const metadata: Metadata = {
  title: "About",
  description: `${site.name} is an independent software developer in ${site.location}, freelancing since ${site.since}.`,
  alternates: { canonical: "/about" },
};

const principles = [
  {
    title: "Security is part of the work, not an extra",
    text: "Sign-in, payments and client data get the same care whether the project is big or small: modern password hashing, two-step verification, sensible limits, and tests for all of it.",
  },
  {
    title: "Tests before promises",
    text: "Every feature I ship comes with automated tests. It is how I can say something works without asking you to take my word for it.",
  },
  {
    title: "Plain words, early",
    text: "You hear about problems when they appear, not at the deadline. If a project is not a good fit for me, I say so at the start.",
  },
  {
    title: "You own what you pay for",
    text: "The code lives in your repository, with the notes needed to run it. No lock-in, no hidden dependency on me.",
  },
];

export default function AboutPage() {
  return (
    <>
      <PageIntro label="About" title={`Hi, I'm ${site.firstName}.`} />
      <Section id="story" index="01" label="Short version">
        <div className="grid gap-10 md:grid-cols-12">
          <div className="reveal md:col-span-4">
            <ProfilePhoto />
            <p className="mt-3 font-mono text-xs text-muted">
              {site.location} · {site.timeZoneLabel}
            </p>
          </div>
          <div className="prose md:col-span-7 md:col-start-6">
            <p>
              I&apos;m {site.name}, an independent software developer from {site.location}. I started
              freelancing in {site.since} and have been building for clients ever since. I am also still a
              high-school student, so I plan work in clear milestones and agree on timelines up front.
            </p>
            <p>
              Today I build websites and web apps, Discord bots, sign-in and licensing systems, and desktop
              tools. Most of it is TypeScript and Python; some of it is C++ and Kotlin when the job calls for
              it.
            </p>
            <p>
              The site you are reading is also my workbench: the public pages you see, and behind them an
              admin that runs my client work, from the first message to the last invoice. It is{" "}
              <a href="https://github.com/leffloard/leffloard.xyz" rel="noopener noreferrer">
                open source
              </a>
              , so you can read exactly how I build things before you hire me.
            </p>
          </div>
        </div>
      </Section>
      <Section id="principles" index="02" label="How I work" title="Four things you can hold me to.">
        <div className="grid gap-4 md:grid-cols-2">
          {principles.map((principle) => (
            <div key={principle.title} className="reveal rounded-2xl border border-line p-6 sm:p-7">
              <h3 className="text-lg font-semibold tracking-tight">{principle.title}</h3>
              <p className="mt-2 text-pretty text-muted">{principle.text}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap gap-3">
          <LinkButton href="/cv" variant="secondary">
            Read the CV <Arrow />
          </LinkButton>
          <LinkButton href="/work" variant="ghost">
            See the work <Arrow />
          </LinkButton>
        </div>
      </Section>
      <CtaBand />
    </>
  );
}
