"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";

export type InboxRow = {
  id: string;
  ref: string;
  kindLabel: string;
  status: string;
  statusLabel: string;
  name: string;
  subject: string;
  snippet: string;
  labels: string[];
  received: string;
  receivedTitle: string;
  replied: boolean;
  snoozedUntil: string | null;
};

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

// The message list. Keyboard: j / k move between messages, Enter opens one, / jumps to the search box.
export function InboxList({ rows, emptyText }: { rows: InboxRow[]; emptyText: string }) {
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (event.key === "/") {
        const search = document.getElementById("inbox-search");
        if (search) {
          event.preventDefault();
          search.focus();
        }
        return;
      }
      if (event.key !== "j" && event.key !== "k") return;
      const links = Array.from(list.current?.querySelectorAll<HTMLAnchorElement>("a[data-row]") ?? []);
      if (links.length === 0) return;
      event.preventDefault();
      const current = links.indexOf(document.activeElement as HTMLAnchorElement);
      const next =
        current === -1 ? 0 : Math.min(Math.max(current + (event.key === "j" ? 1 : -1), 0), links.length - 1);
      links[next]?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line-strong px-5 py-10 text-center text-sm text-muted">
        {emptyText}
      </p>
    );
  }

  return (
    <ul ref={list} className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
      {rows.map((row) => {
        const unread = row.status === "new";
        return (
          <li key={row.id}>
            <Link
              href={`/admin/inbox/${row.id}`}
              data-row
              className={cn(
                "grid gap-1 px-4 py-3 transition-colors hover:bg-white/[0.03] focus-visible:bg-white/[0.05] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent sm:px-5",
              )}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden
                  className={cn("size-2 shrink-0 rounded-full", unread ? "bg-accent" : "bg-transparent")}
                />
                <span className={cn("truncate text-sm", unread ? "font-semibold text-ink" : "text-ink/85")}>
                  {row.name}
                </span>
                {unread ? <span className="sr-only">(new)</span> : null}
                <Badge className="hidden sm:inline-flex">{row.kindLabel}</Badge>
                {row.status !== "new" ? (
                  <Badge
                    tone={row.status === "confirmed" ? "success" : "neutral"}
                    className="hidden md:inline-flex"
                  >
                    {row.statusLabel}
                  </Badge>
                ) : null}
                <time className="ml-auto shrink-0 text-xs text-muted" title={row.receivedTitle}>
                  {row.received}
                </time>
              </div>
              <div className="flex min-w-0 items-baseline gap-2 pl-[18px]">
                <span className={cn("truncate text-[13px]", unread ? "text-ink" : "text-ink/80")}>
                  {row.subject}
                </span>
                {row.replied ? <Badge tone="accent">replied</Badge> : null}
                {row.labels.map((label) => (
                  <Badge key={label}>{label}</Badge>
                ))}
              </div>
              <p className="truncate pl-[18px] text-[13px] text-muted">
                {row.snoozedUntil ? `Snoozed until ${row.snoozedUntil} · ` : ""}
                {row.snippet}
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
