"use client";

import { useState } from "react";
import { setRepoShownAction, syncGithubAction } from "@/app/(admin)/admin/(shell)/content/actions";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

export type RepoRow = {
  id: string;
  name: string;
  url: string;
  description: string;
  language: string | null;
  stars: number;
  pushed: string | null;
  fork: boolean;
  archived: boolean;
  show: boolean;
};

export function SyncButton() {
  const { run, pending, message } = useActionRunner();
  return (
    <div className="grid gap-3">
      <div>
        <Button
          size="sm"
          pending={pending === "sync"}
          onClick={() => run("sync", () => syncGithubAction({}))}
        >
          Sync now
        </Button>
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </div>
  );
}

function RepoItem({ row }: { row: RepoRow }) {
  const { run, pending, message } = useActionRunner();
  // Ticks at once, and goes back if saving fails.
  const [show, setShow] = useState(row.show);
  const [saved, setSaved] = useState(row.show);
  if (row.show !== saved) {
    setSaved(row.show);
    setShow(row.show);
  }
  async function toggle(next: boolean) {
    setShow(next);
    const result = await run("show", () => setRepoShownAction({ id: row.id, show: next }));
    if (!result.ok) setShow(!next);
  }
  return (
    <li className="grid gap-1 px-4 py-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-w-0 flex-1 items-center gap-2">
          <input
            type="checkbox"
            checked={show}
            disabled={pending !== null}
            onChange={(event) => void toggle(event.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          <span className="truncate font-mono font-medium">{row.name}</span>
          <span className="sr-only"> on the work page</span>
        </label>
        {row.fork ? <Badge>fork</Badge> : null}
        {row.archived ? <Badge>archived</Badge> : null}
        <span className="font-mono text-xs text-muted">
          {row.language ?? "—"} · ★ {row.stars}
          {row.pushed ? ` · ${row.pushed}` : ""}
        </span>
        <a
          href={row.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-accent hover:underline"
        >
          GitHub
        </a>
      </div>
      {row.description ? <p className="text-muted">{row.description}</p> : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </li>
  );
}

export function RepoList({ rows }: { rows: RepoRow[] }) {
  if (!rows.length)
    return <p className="text-sm text-muted">No repositories yet. Sync to read them from GitHub.</p>;
  return (
    <ul className="divide-y divide-line rounded-lg border border-line">
      {rows.map((row) => (
        <RepoItem key={row.id} row={row} />
      ))}
    </ul>
  );
}
