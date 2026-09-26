import { Arrow, LinkButton } from "@/components/site/link-button";

export default function NotFound() {
  return (
    <div className="px-5 py-24 sm:px-10 sm:py-32">
      <p className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">Error 404</p>
      <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-6xl">This page does not exist.</h1>
      <p className="mt-5 max-w-xl text-lg text-muted">It may have moved when the site was rebuilt.</p>
      <div className="mt-10 flex flex-wrap gap-3">
        <LinkButton href="/">
          Home <Arrow />
        </LinkButton>
        <LinkButton href="/work" variant="secondary">
          Work
        </LinkButton>
      </div>
    </div>
  );
}
