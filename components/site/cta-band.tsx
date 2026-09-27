import { Arrow, LinkButton } from "@/components/site/link-button";
import { site } from "@/content/site";

export function CtaBand() {
  return (
    <section aria-labelledby="cta-title" className="relative overflow-hidden border-t border-line">
      <span aria-hidden className="crosshair top-0 left-0" />
      <span aria-hidden className="crosshair top-0 left-full" />
      <div
        aria-hidden
        className="absolute inset-0 [background:radial-gradient(60%_80%_at_85%_120%,color-mix(in_oklch,var(--color-accent)_16%,transparent),transparent_70%)]"
      />
      <div className="relative grid gap-8 px-5 py-20 sm:px-10 sm:py-28 md:grid-cols-12">
        <div className="md:col-span-8">
          <p className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">Next step</p>
          <h2
            id="cta-title"
            className="mt-4 text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl"
          >
            Have a project in mind? Tell me what it needs to do.
          </h2>
          <p className="mt-5 max-w-xl text-lg text-pretty text-muted">
            A few sentences are enough to start. You get an honest answer: a rough estimate, the questions
            that matter, or a recommendation for someone better suited.
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 md:col-span-4 md:items-end md:justify-end">
          <LinkButton href="/contact">
            Start a project <Arrow />
          </LinkButton>
          <LinkButton href="/book" variant="secondary">
            Book a call
          </LinkButton>
          <a
            href={`mailto:${site.email}`}
            className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            or email {site.email}
          </a>
        </div>
      </div>
    </section>
  );
}
