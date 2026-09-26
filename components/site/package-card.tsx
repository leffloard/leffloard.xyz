import { formatPrice } from "@/components/site/service-card";
import { cn } from "@/components/ui/cn";
import type { Package } from "@/lib/content/types";

export function PackageCard({ item }: { item: Package }) {
  return (
    <div
      className={cn(
        "relative flex h-full flex-col rounded-2xl border p-6 sm:p-7",
        item.highlighted
          ? "border-accent/50 bg-surface shadow-[0_0_0_1px_var(--color-accent)_inset]"
          : "border-line bg-surface/50",
      )}
    >
      {item.highlighted ? (
        <span className="absolute -top-3 left-6 rounded-full bg-accent px-2.5 py-0.5 font-mono text-[11px] tracking-wide text-accent-ink">
          Most chosen
        </span>
      ) : null}
      <h3 className="text-lg font-semibold tracking-tight">{item.name}</h3>
      <p className="mt-1 text-sm text-muted">{item.summary}</p>
      <p className="mt-6 flex items-baseline gap-1.5">
        <span className="text-sm text-muted">from</span>
        <span className="text-4xl font-semibold tracking-tight">{formatPrice(item.price)}</span>
        {item.per ? <span className="text-sm text-muted">/ {item.per}</span> : null}
      </p>
      <ul className="mt-6 grid gap-2.5 text-[15px]">
        {item.includes.map((line) => (
          <li key={line} className="flex gap-2.5">
            <svg
              viewBox="0 0 16 16"
              aria-hidden
              className="mt-1 size-4 shrink-0 text-accent"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {line}
          </li>
        ))}
      </ul>
      <dl className="mt-auto grid grid-cols-2 gap-3 border-t border-line pt-5 text-sm">
        <div>
          <dt className="font-mono text-[11px] tracking-[0.12em] text-muted uppercase">Timeline</dt>
          <dd className="mt-1">{item.timeline}</dd>
        </div>
        <div>
          <dt className="font-mono text-[11px] tracking-[0.12em] text-muted uppercase">Revisions</dt>
          <dd className="mt-1">{item.revisions === null ? "Per project" : `${item.revisions} included`}</dd>
        </div>
      </dl>
    </div>
  );
}
