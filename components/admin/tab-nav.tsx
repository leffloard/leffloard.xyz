"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";

export type Tab = { href: string; label: string; count?: number };

// Sub-pages as tabs; the current one is the tab whose address matches exactly.
export function TabNav({ label, tabs }: { label: string; tabs: Tab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] transition-colors",
              active ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span className="font-mono text-[11px] text-muted">{tab.count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
