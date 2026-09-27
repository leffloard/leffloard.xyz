import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";

// Quotes or invoices as rows: number, what for, who, how much, where it stands.

export type DocumentRow = {
  id: string;
  href: string;
  number: string;
  title: string;
  who: string;
  total: string;
  state: string;
  tone: "neutral" | "accent" | "success" | "warning" | "danger";
  when: string;
};

export function DocumentList({ rows, empty }: { rows: DocumentRow[]; empty: string }) {
  if (!rows.length) {
    return (
      <p className="rounded-xl border border-dashed border-line-strong px-5 py-10 text-center text-sm text-muted">
        {empty}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            href={row.href}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-[13px] hover:bg-white/[0.03]"
          >
            <span
              className={cn(
                "w-28 shrink-0 font-mono text-[12px]",
                row.number === "Draft" ? "text-muted" : "",
              )}
            >
              {row.number}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{row.title}</span>
              <span className="block truncate text-xs text-muted">{row.who}</span>
            </span>
            <span className="font-mono tabular-nums">{row.total}</span>
            <Badge tone={row.tone}>{row.state}</Badge>
            <span className="w-32 shrink-0 text-right text-xs text-muted">{row.when}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ViewTabs<View extends string>({
  label,
  views,
  current,
  counts,
  labels,
  hrefFor,
}: {
  label: string;
  views: readonly View[];
  current: View;
  counts: Record<View, number>;
  labels: Record<View, string>;
  hrefFor: (view: View) => string;
}) {
  return (
    <nav aria-label={label} className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {views.map((view) => (
        <Link
          key={view}
          href={hrefFor(view)}
          aria-current={view === current ? "page" : undefined}
          className={cn(
            "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] transition-colors",
            view === current ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {labels[view]}
          <span className="font-mono text-[11px] text-muted">{counts[view]}</span>
        </Link>
      ))}
    </nav>
  );
}
