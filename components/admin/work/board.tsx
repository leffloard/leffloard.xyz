"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/components/ui/cn";
import { Notice } from "@/components/ui/notice";
import type { ActionResult } from "@/lib/action-result";

// A kanban board that works the same with a keyboard and a pointer. Focus a card, then:
//   arrow keys          move the focus between cards and columns
//   Shift + arrow keys  move the card up, down, or to the next column
//   Enter               open it
// Cards can also be dragged. Moves show at once and are undone if the server refuses them.

export type BoardColumn = { id: string; title: string };
export type BoardCard = { id: string; column: string; label: string; href: string };
export type BoardMove = { id: string; column: string; afterId: string | null };

function applyMove<T extends BoardCard>(cards: T[], move: BoardMove): T[] {
  const card = cards.find((item) => item.id === move.id);
  if (!card) return cards;
  const rest = cards.filter((item) => item.id !== move.id);
  let index: number;
  if (move.afterId) {
    index = rest.findIndex((item) => item.id === move.afterId) + 1;
    if (index === 0) index = rest.length;
  } else {
    index = rest.findIndex((item) => item.column === move.column);
    if (index === -1) index = rest.length;
  }
  return [...rest.slice(0, index), { ...card, column: move.column }, ...rest.slice(index)];
}

const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

export function Board<T extends BoardCard>({
  label,
  columns,
  cards,
  renderCard,
  onMove,
  footer,
  emptyText = "Nothing here.",
}: {
  label: string;
  columns: BoardColumn[];
  cards: T[];
  renderCard: (card: T) => ReactNode;
  onMove: (move: BoardMove) => Promise<ActionResult<unknown>>;
  footer?: (column: BoardColumn) => ReactNode;
  emptyText?: string;
}) {
  const [shown, showMove] = useOptimistic(cards, (state: T[], move: BoardMove) => applyMove(state, move));
  const [, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState("");
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ column: string; index: number } | null>(null);
  const focusAfterMove = useRef<string | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const hintId = useId();

  const inColumn = (column: string, list: T[] = shown) => list.filter((card) => card.column === column);

  // A moved card is rendered again (in another column, say): give it the focus back.
  useEffect(() => {
    const id = focusAfterMove.current;
    if (!id) return;
    const element = board.current?.querySelector<HTMLElement>(`[data-card="${id}"]`);
    if (element && document.activeElement !== element) element.focus();
  });

  function focusCard(id: string | undefined) {
    if (id) board.current?.querySelector<HTMLElement>(`[data-card="${id}"]`)?.focus();
  }

  function move(next: BoardMove) {
    const card = shown.find((item) => item.id === next.id);
    if (!card) return;
    const after = applyMove(shown, next);
    const column = inColumn(next.column, after);
    const position = column.findIndex((item) => item.id === next.id) + 1;
    const title = columns.find((item) => item.id === next.column)?.title ?? next.column;
    focusAfterMove.current = next.id;
    setNotice(null);
    setAnnouncement(`Moved “${card.label}” to ${title}, position ${position} of ${column.length}.`);
    startTransition(async () => {
      showMove(next);
      const result = await onMove(next);
      if (!result.ok) {
        setNotice({ tone: "error", text: result.error });
        setAnnouncement(`Could not move “${card.label}”: ${result.error}`);
      } else if (result.message) {
        // Something beyond the move itself (a repeating task went to its next date, say).
        setNotice({ tone: "info", text: result.message });
      }
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>, card: T) {
    if (!ARROWS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const column = inColumn(card.column);
    const index = column.findIndex((item) => item.id === card.id);
    const columnIndex = columns.findIndex((item) => item.id === card.column);
    const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;

    if (!event.shiftKey) {
      focusAfterMove.current = null;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        focusCard(column[index + step]?.id);
        return;
      }
      // The nearest column in that direction with a card in it, at about the same height.
      for (let next = columnIndex + step; next >= 0 && next < columns.length; next += step) {
        const target = inColumn(columns[next]!.id);
        if (target.length) {
          focusCard(target[Math.min(index, target.length - 1)]?.id);
          return;
        }
      }
      return;
    }

    if (event.key === "ArrowUp") {
      if (index > 0) move({ id: card.id, column: card.column, afterId: column[index - 2]?.id ?? null });
      return;
    }
    if (event.key === "ArrowDown") {
      if (index < column.length - 1)
        move({ id: card.id, column: card.column, afterId: column[index + 1]!.id });
      return;
    }
    const target = columns[columnIndex + step];
    if (!target) return;
    const targetCards = inColumn(target.id);
    const position = Math.min(index, targetCards.length);
    move({ id: card.id, column: target.id, afterId: targetCards[position - 1]?.id ?? null });
  }

  // Where a dragged card would land in a column: before the first card whose middle is below the pointer.
  function dropIndex(list: HTMLElement, pointerY: number): number {
    const items = Array.from(list.querySelectorAll<HTMLElement>("[data-card]")).filter(
      (element) => element.dataset.card !== dragging,
    );
    const index = items.findIndex((element) => {
      const box = element.getBoundingClientRect();
      return pointerY < box.top + box.height / 2;
    });
    return index === -1 ? items.length : index;
  }

  function onDragOver(event: DragEvent<HTMLElement>, column: string) {
    if (!dragging) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const index = dropIndex(event.currentTarget, event.clientY);
    if (dropAt?.column !== column || dropAt.index !== index) setDropAt({ column, index });
  }

  function onDrop(event: DragEvent<HTMLElement>, column: string) {
    event.preventDefault();
    const id = dragging;
    setDragging(null);
    setDropAt(null);
    if (!id) return;
    const others = inColumn(column).filter((card) => card.id !== id);
    const next = {
      id,
      column,
      afterId: others[dropIndex(event.currentTarget, event.clientY) - 1]?.id ?? null,
    };
    const order = (list: T[]) =>
      inColumn(column, list)
        .map((card) => card.id)
        .join();
    const sameColumn = shown.find((card) => card.id === id)?.column === column;
    if (!(sameColumn && order(shown) === order(applyMove(shown, next)))) move(next);
  }

  return (
    <div ref={board}>
      <p id={hintId} className="sr-only">
        Press Shift and an arrow key to move the card, or drag it. Enter opens it.
      </p>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {notice ? (
        <Notice tone={notice.tone} className="mb-3">
          {notice.text}
        </Notice>
      ) : null}
      <div
        role="group"
        aria-label={label}
        className="grid auto-cols-[minmax(208px,1fr)] grid-flow-col gap-4 overflow-x-auto pb-2"
      >
        {columns.map((column) => {
          const columnCards = inColumn(column.id);
          // The cards a dragged card can land between (itself left out).
          const others = columnCards.filter((card) => card.id !== dragging);
          const headingId = `${hintId}-${column.id}`;
          return (
            <section
              key={column.id}
              aria-labelledby={headingId}
              className="flex min-h-40 flex-col rounded-xl border border-line bg-surface/60"
            >
              <h2
                id={headingId}
                className="flex items-center justify-between border-b border-line px-3 py-2.5 text-[13px] font-semibold"
              >
                {column.title}
                <span className="font-mono text-[11px] font-normal text-muted">{columnCards.length}</span>
              </h2>
              <ol
                className="flex flex-1 flex-col gap-2 p-2"
                onDragOver={(event) => onDragOver(event, column.id)}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropAt(null);
                }}
                onDrop={(event) => onDrop(event, column.id)}
              >
                {columnCards.map((card) => (
                  <li key={card.id} className="grid gap-2">
                    {dropAt?.column === column.id && others[dropAt.index]?.id === card.id ? (
                      <span aria-hidden className="h-0.5 rounded-full bg-accent" />
                    ) : null}
                    <Link
                      href={card.href}
                      data-card={card.id}
                      draggable
                      aria-describedby={hintId}
                      onKeyDown={(event) => onKeyDown(event, card)}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", card.id);
                        setDragging(card.id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setDropAt(null);
                      }}
                      className={cn(
                        "block rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[13px] transition-[border-color,opacity]",
                        "hover:border-line-strong focus-visible:border-accent/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                        dragging === card.id && "opacity-40",
                      )}
                    >
                      {renderCard(card)}
                    </Link>
                  </li>
                ))}
                {dropAt?.column === column.id && dropAt.index >= others.length ? (
                  <li aria-hidden className="h-0.5 rounded-full bg-accent" />
                ) : null}
                {columnCards.length === 0 && dropAt?.column !== column.id ? (
                  <li className="px-1 py-3 text-center text-xs text-muted">{emptyText}</li>
                ) : null}
              </ol>
              {footer ? <div className="border-t border-line p-2">{footer(column)}</div> : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
