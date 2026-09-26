"use client";

import Link from "next/link";
import { useEffect, useOptimistic, useTransition } from "react";
import { setTaskDoneAction } from "@/app/(admin)/admin/(shell)/tasks/actions";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { DueText } from "@/components/admin/work/due-text";
import { FlagMark } from "@/components/admin/work/flag-mark";
import { cn } from "@/components/ui/cn";
import { Notice } from "@/components/ui/notice";
import type { DueTone } from "@/lib/work/dates";

export type TaskRow = {
  id: string;
  title: string;
  done: boolean;
  due: { text: string; tone: DueTone } | null;
  flagged: boolean;
  repeats: boolean;
  checklist: string | null; // "2/5"
  project: { id: string; label: string } | null;
};

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

// A list of tasks with tick boxes. Keyboard: j / k move between tasks, x ticks the focused one off,
// Enter opens it, n jumps to the quick-add box. With several lists on a page, only one listens
// (`keyboard`), and it moves across all of them.
export function TaskList({
  rows,
  emptyText,
  showProject = true,
  keyboard = true,
}: {
  rows: TaskRow[];
  emptyText: string;
  showProject?: boolean;
  keyboard?: boolean;
}) {
  const { run, message } = useActionRunner();
  const [, startTransition] = useTransition();
  const [ticked, tick] = useOptimistic(
    new Map<string, boolean>(),
    (state: Map<string, boolean>, [id, done]: [string, boolean]) => new Map(state).set(id, done),
  );

  function toggle(row: TaskRow, done: boolean) {
    startTransition(async () => {
      tick([row.id, done]);
      await run(row.id, () => setTaskDoneAction({ id: row.id, done }));
    });
  }

  useEffect(() => {
    if (!keyboard) return;
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (event.key === "n") {
        const input = document.getElementById("quick-add-title");
        if (input) {
          event.preventDefault();
          input.focus();
        }
        return;
      }
      // Every list on the page, so j and k run across grouped lists too.
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[data-task]"));
      if (links.length === 0) return;
      const current = links.indexOf(document.activeElement as HTMLAnchorElement);
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        const next =
          current === -1
            ? 0
            : Math.min(Math.max(current + (event.key === "j" ? 1 : -1), 0), links.length - 1);
        links[next]?.focus();
        return;
      }
      if (event.key === "x" && current !== -1) {
        event.preventDefault();
        document
          .querySelector<HTMLInputElement>(`input[data-tick="${links[current]!.dataset.task}"]`)
          ?.click();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [keyboard]);

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line-strong px-5 py-8 text-center text-sm text-muted">
        {emptyText}
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {rows.map((row) => {
          const done = ticked.get(row.id) ?? row.done;
          return (
            <li key={row.id} className="flex items-start gap-3 px-4 py-2.5 sm:px-5">
              <input
                type="checkbox"
                data-tick={row.id}
                checked={done}
                onChange={(event) => toggle(row, event.target.checked)}
                aria-label={`${done ? "Not done" : "Done"}: ${row.title}`}
                className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
              />
              <div className="grid min-w-0 flex-1 gap-0.5">
                <Link
                  href={`/admin/tasks/${row.id}`}
                  data-task={row.id}
                  className={cn(
                    "truncate text-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                    done ? "text-muted line-through" : "text-ink",
                  )}
                >
                  {row.flagged ? <FlagMark /> : null}
                  {row.title}
                </Link>
                {(showProject && row.project) || row.checklist || row.repeats ? (
                  <p className="flex flex-wrap gap-x-3 text-xs text-muted">
                    {showProject && row.project ? (
                      <Link href={`/admin/projects/${row.project.id}/tasks`} className="hover:text-ink">
                        {row.project.label}
                      </Link>
                    ) : null}
                    {row.checklist ? <span>{row.checklist} steps</span> : null}
                    {row.repeats ? <span>repeats</span> : null}
                  </p>
                ) : null}
              </div>
              {row.due && !done ? <DueText due={row.due} className="mt-0.5 shrink-0 text-xs" /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
