"use client";

import { moveProjectAction } from "@/app/(admin)/admin/(shell)/projects/actions";
import { Board, type BoardCard, type BoardColumn } from "@/components/admin/work/board";
import { DueText } from "@/components/admin/work/due-text";
import type { DueTone } from "@/lib/work/dates";
import type { ProjectStage } from "@/lib/work/options";

export type ProjectCard = BoardCard & {
  ref: string;
  clientName: string;
  due: { text: string; tone: DueTone } | null;
  openTasks: number;
  revisions: string | null; // "1 of 2 rounds"
};

export function ProjectBoard({ columns, cards }: { columns: BoardColumn[]; cards: ProjectCard[] }) {
  return (
    <Board
      label="Projects by stage"
      columns={columns}
      cards={cards}
      emptyText="No projects."
      onMove={(move) =>
        moveProjectAction({ id: move.id, stage: move.column as ProjectStage, after: move.afterId ?? "top" })
      }
      renderCard={(card) => (
        <span className="grid gap-1.5">
          <span className="flex items-baseline justify-between gap-2">
            <span className="font-medium text-ink">{card.label}</span>
            <span className="shrink-0 font-mono text-[11px] text-muted">{card.ref}</span>
          </span>
          <span className="truncate text-xs text-muted">{card.clientName}</span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            {card.due ? <DueText due={card.due} /> : null}
            {card.openTasks ? <span>{card.openTasks} open</span> : null}
            {card.revisions ? <span>{card.revisions}</span> : null}
          </span>
        </span>
      )}
    />
  );
}
