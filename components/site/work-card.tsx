import Link from "next/link";
import { Arrow } from "@/components/site/link-button";
import { Spotlight } from "@/components/site/spotlight";
import { cn } from "@/components/ui/cn";
import type { WorkItem } from "@/lib/content/types";

export function WorkCard({
  item,
  large = false,
  className,
}: {
  item: WorkItem;
  large?: boolean;
  className?: string;
}) {
  return (
    <Spotlight className={cn("h-full", className)}>
      <Link
        href={`/work/${item.slug}`}
        className="group relative flex h-full flex-col gap-6 p-6 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent sm:p-8"
      >
        <div className="flex items-center justify-between gap-3 font-mono text-[11px] tracking-[0.12em] text-muted uppercase">
          <span>{item.category}</span>
          <span>
            {item.kind} · {item.year}
          </span>
        </div>
        {item.highlights.length ? (
          <ul
            className={cn(
              "grid gap-1.5 font-mono text-xs text-muted",
              large && "sm:justify-self-end sm:text-right",
            )}
          >
            {item.highlights.map((highlight) => (
              <li key={highlight} className={cn("flex items-center gap-2", large && "sm:justify-end")}>
                <span aria-hidden className="size-1 rounded-full bg-accent" />
                {highlight}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-auto">
          <h3 className={cn("font-semibold tracking-tight", large ? "text-3xl sm:text-4xl" : "text-2xl")}>
            {item.title}
          </h3>
          <p className={cn("mt-3 text-pretty text-muted", large ? "max-w-xl text-lg" : "text-[15px]")}>
            {item.tagline}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <ul className="flex flex-wrap gap-1.5" aria-label="Stack">
            {item.stack.slice(0, large ? 6 : 4).map((tech) => (
              <li key={tech} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted">
                {tech}
              </li>
            ))}
          </ul>
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink">
            Case study <Arrow />
          </span>
        </div>
      </Link>
    </Spotlight>
  );
}
