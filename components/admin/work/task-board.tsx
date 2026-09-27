"use client";

import { useRef, useState } from "react";
import { createTaskAction, moveTaskAction } from "@/app/(admin)/admin/(shell)/tasks/actions";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Board, type BoardCard, type BoardColumn } from "@/components/admin/work/board";
import { DueText } from "@/components/admin/work/due-text";
import { FlagMark } from "@/components/admin/work/flag-mark";
import { compactInputClasses } from "@/components/ui/field";
import type { DueTone } from "@/lib/work/dates";
import type { TaskStatus } from "@/lib/work/options";

export type TaskCard = BoardCard & {
  due: { text: string; tone: DueTone } | null;
  flagged: boolean;
  repeats: boolean;
  checklist: string | null; // "2/5"
};

function QuickAdd({ projectId, status }: { projectId: string; status: TaskStatus }) {
  const { run, pending, message } = useActionRunner();
  const [title, setTitle] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    const result = await run("add", () => createTaskAction({ title, projectId, status }));
    if (result.ok) setTitle("");
    input.current?.focus();
  }

  return (
    <form onSubmit={add} className="grid gap-1.5">
      <label htmlFor={`add-${status}`} className="sr-only">
        Add a task to this column
      </label>
      <input
        ref={input}
        id={`add-${status}`}
        className={compactInputClasses}
        placeholder="Add a task…"
        maxLength={300}
        value={title}
        disabled={pending === "add"}
        onChange={(event) => setTitle(event.target.value)}
      />
      {message?.tone === "error" ? <p className="text-xs text-danger">{message.text}</p> : null}
    </form>
  );
}

export function TaskBoard({
  projectId,
  columns,
  cards,
}: {
  projectId: string;
  columns: BoardColumn[];
  cards: TaskCard[];
}) {
  return (
    <Board
      label="Tasks by status"
      columns={columns}
      cards={cards}
      emptyText="No tasks."
      onMove={(move) =>
        moveTaskAction({ id: move.id, status: move.column as TaskStatus, after: move.afterId ?? "top" })
      }
      footer={(column) =>
        column.id === "done" ? null : <QuickAdd projectId={projectId} status={column.id as TaskStatus} />
      }
      renderCard={(card) => (
        <span className="grid gap-1.5">
          <span className={card.column === "done" ? "text-muted line-through" : "text-ink"}>
            {card.flagged ? <FlagMark /> : null}
            {card.label}
          </span>
          {card.due || card.checklist || card.repeats ? (
            <span className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
              {card.due && card.column !== "done" ? <DueText due={card.due} /> : null}
              {card.checklist ? <span>{card.checklist}</span> : null}
              {card.repeats ? <span>repeats</span> : null}
            </span>
          ) : null}
        </span>
      )}
    />
  );
}
