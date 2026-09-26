"use client";

import Link from "next/link";
import { moveContentAction } from "@/app/(admin)/admin/(shell)/content/actions";
import type { EditorStatus } from "@/components/admin/content/content-editor";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

export type ListRow = { id: string; title: string; detail: string; status: EditorStatus; updated: string };

const STATUS: Record<EditorStatus, { label: string; tone: "neutral" | "success" | "warning" | "accent" }> = {
  new: { label: "New", tone: "neutral" },
  draft: { label: "Draft", tone: "neutral" },
  published: { label: "Published", tone: "success" },
  changed: { label: "Changes not published", tone: "warning" },
  scheduled: { label: "Scheduled", tone: "accent" },
};

// Items of one kind in the site's order, which the arrows change.
export function ContentList({ kind, rows, ordered }: { kind: string; rows: ListRow[]; ordered: boolean }) {
  const { run, pending, message } = useActionRunner();
  return (
    <div className="grid gap-3">
      {message?.tone === "error" ? <Notice tone="error">{message.text}</Notice> : null}
      <ul className="divide-y divide-line rounded-lg border border-line">
        {rows.map((row, index) => (
          <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[13px]">
            <Link href={`/admin/content/${kind}/${row.id}`} className="min-w-0 flex-1 hover:text-accent">
              <span className="block truncate font-medium">{row.title}</span>
              {row.detail ? <span className="block truncate text-xs text-muted">{row.detail}</span> : null}
            </Link>
            <Badge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Badge>
            <span className="hidden text-xs text-muted sm:inline">{row.updated}</span>
            {ordered ? (
              <span className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={index === 0}
                  pending={pending === `up-${row.id}`}
                  aria-label={`Move ${row.title} up`}
                  onClick={() =>
                    run(`up-${row.id}`, () => moveContentAction({ id: row.id, direction: "up" }))
                  }
                >
                  ↑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={index === rows.length - 1}
                  pending={pending === `down-${row.id}`}
                  aria-label={`Move ${row.title} down`}
                  onClick={() =>
                    run(`down-${row.id}`, () => moveContentAction({ id: row.id, direction: "down" }))
                  }
                >
                  ↓
                </Button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
