"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { searchEverythingAction } from "@/app/(admin)/admin/(shell)/search-actions";
import { cn } from "@/components/ui/cn";
import { COMMANDS, matchesCommand, PAGE_SHORTCUTS, PREFIXES, SHORTCUTS } from "@/lib/admin/commands";

// Ctrl/Cmd+K anywhere in the admin: jump to a page, create something, or find a message, client, project,
// task, quote, invoice, meeting or piece of content by name. Two-key shortcuts (g then i: the inbox) work
// when no field has focus, and ? lists them.

type Item = { id: string; group: string; label: string; detail?: string; href: string; shortcut?: string };
type SearchHit = { id: string; type: string; title: string; detail: string; href: string };

const OPEN_EVENT = "admin:command-palette";
const SEQUENCE_MS = 1500;
const NO_HITS: SearchHit[] = [];

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function Keys({ keys }: { keys: string }) {
  return (
    <span className="flex shrink-0 gap-1">
      {keys.split(" ").map((key, index) => (
        <kbd
          key={index}
          className="rounded border border-line-strong px-1.5 font-mono text-[10px] leading-4 text-muted"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

export function PaletteButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-md border border-line px-2.5 text-[13px] text-muted transition-colors hover:border-line-strong hover:text-ink",
        className,
      )}
    >
      <svg
        viewBox="0 0 20 20"
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden
      >
        <path d="M9 15a6 6 0 100-12 6 6 0 000 12zM17 17l-3.8-3.8" strokeLinecap="round" />
      </svg>
      Search<span className="sr-only"> the admin</span>
      <span className="ml-auto hidden font-mono text-[10px] sm:inline" aria-hidden>
        Ctrl K
      </span>
    </button>
  );
}

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [query, setQuery] = useState("");
  // The last search's answer, and the text it was for.
  const [found, setFound] = useState<{ text: string; hits: SearchHit[] }>({ text: "", hits: [] });
  const [active, setActive] = useState(0);
  const returnTo = useRef<HTMLElement | null>(null);
  const state = useRef({ open, help });
  useEffect(() => {
    state.current = { open, help };
  }, [open, help]);
  // A new page closes the palette (going back, say, while it is open).
  const [page, setPage] = useState(pathname);
  if (page !== pathname) {
    setPage(pathname);
    setOpen(false);
    setHelp(false);
  }
  const listId = useId();
  const helpTitle = useId();
  const inputId = `${listId}-input`;
  const closeId = `${helpTitle}-close`;
  const optionId = (index: number) => `${listId}-option-${index}`;

  function show(which: "palette" | "help") {
    if (!state.current.open && !state.current.help) {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    if (which === "palette") {
      setQuery("");
      setActive(0);
    }
    setOpen(which === "palette");
    setHelp(which === "help");
    state.current = { open: which === "palette", help: which === "help" };
  }

  function close() {
    setOpen(false);
    setHelp(false);
    state.current = { open: false, help: false };
    returnTo.current?.focus();
    returnTo.current = null;
  }

  // Shortcuts. Listened for while the event goes down to the page, so a two-key shortcut isn't also taken
  // by a list's own keys (x ticks a task).
  useEffect(() => {
    let prefix: { key: string; at: number } | null = null;
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        event.stopPropagation();
        if (state.current.open) close();
        else show("palette");
        return;
      }
      if (state.current.open || state.current.help) {
        // Keys belong to the open dialog: Escape closes it, Tab stays in it, and nothing reaches the page's
        // own keys behind it (j, k, x, n, /). Only the search box gets its typing and arrows.
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape") close();
          else document.getElementById(state.current.open ? inputId : closeId)?.focus();
          return;
        }
        if (!(event.target instanceof HTMLElement && event.target.id === inputId)) event.stopPropagation();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) {
        prefix = null;
        return;
      }
      if (prefix && Date.now() - prefix.at < SEQUENCE_MS) {
        const href = SHORTCUTS.get(`${prefix.key} ${event.key.toLowerCase()}`);
        prefix = null;
        if (href) {
          event.preventDefault();
          event.stopPropagation();
          router.push(href);
        }
        return;
      }
      prefix = null;
      if (event.key === "?") {
        event.preventDefault();
        show("help");
      } else if ((PREFIXES as readonly string[]).includes(event.key)) {
        prefix = { key: event.key, at: Date.now() };
      }
    }
    const onOpen = () => show("palette");
    document.addEventListener("keydown", onKey, true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [router, inputId, closeId]);

  // The search, a moment after typing stops; an answer that arrives late for an older text is dropped.
  const text = query.trim();
  const searchable = open && text.length >= 2;
  const searching = searchable && found.text !== text;
  const hits = searchable ? found.hits : NO_HITS;
  useEffect(() => {
    if (!searchable) return;
    let current = true;
    const timer = window.setTimeout(async () => {
      const result = await searchEverythingAction({ query: text });
      if (current) setFound({ text, hits: result.ok ? result.data : [] });
    }, 200);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [searchable, text]);

  const items = useMemo<Item[]>(() => {
    const commands = text
      ? COMMANDS.filter((command) => matchesCommand(command, text))
      : COMMANDS.filter((command) => command.shortcut);
    return [
      ...commands.map((command) => ({
        id: command.id,
        group: command.group,
        label: command.label,
        href: command.href,
        shortcut: command.shortcut,
      })),
      ...hits.map((hit) => ({
        id: hit.id,
        group: hit.type,
        label: hit.title,
        detail: hit.detail,
        href: hit.href,
      })),
    ];
  }, [text, hits]);
  // New results can be fewer than before.
  const selected = Math.max(0, Math.min(active, items.length - 1));

  useEffect(() => {
    if (open) document.getElementById(`${listId}-option-${selected}`)?.scrollIntoView({ block: "nearest" });
  }, [selected, open, listId]);

  function go(item: Item) {
    setOpen(false);
    returnTo.current = null;
    router.push(item.href);
  }

  function onInputKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(Math.min(selected + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(Math.max(selected - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[selected];
      if (item) go(item);
    }
  }

  const groups: { name: string; items: { item: Item; index: number }[] }[] = [];
  items.forEach((item, index) => {
    const group = groups.at(-1)?.name === item.group ? groups.at(-1)! : { name: item.group, items: [] };
    if (group !== groups.at(-1)) groups.push(group);
    group.items.push({ item, index });
  });

  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-2xl shadow-black/50"
          >
            <input
              id={inputId}
              autoFocus
              role="combobox"
              aria-expanded={items.length > 0}
              aria-controls={listId}
              aria-activedescendant={items.length ? optionId(selected) : undefined}
              aria-autocomplete="list"
              aria-label="Search, or jump to a page"
              placeholder="Search, or jump to a page…"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onInputKey}
              className="h-12 w-full border-b border-line bg-transparent px-4 text-sm outline-none placeholder:text-muted"
            />
            {/* A click in the list keeps the focus in the search box. */}
            <div
              id={listId}
              role="listbox"
              aria-label="Results"
              onMouseDown={(event) => event.preventDefault()}
              className="max-h-[50vh] overflow-y-auto p-2"
            >
              {groups.map((group) => (
                <div key={`${group.name}-${group.items[0]!.index}`} role="group" aria-label={group.name}>
                  <div
                    aria-hidden
                    className="px-2 pt-2 pb-1 font-mono text-[10px] tracking-[0.08em] text-muted uppercase"
                  >
                    {group.name}
                  </div>
                  {group.items.map(({ item, index }) => (
                    <div
                      key={item.id}
                      id={optionId(index)}
                      role="option"
                      aria-selected={index === selected}
                      onMouseMove={() => setActive(index)}
                      onClick={() => go(item)}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-[13px]",
                        index === selected ? "bg-white/[0.07] text-ink" : "text-muted",
                      )}
                    >
                      <span className="min-w-0 truncate">{item.label}</span>
                      {item.detail ? (
                        <span className="min-w-0 flex-1 truncate text-xs text-muted">{item.detail}</span>
                      ) : (
                        <span className="flex-1" />
                      )}
                      {item.shortcut ? <Keys keys={item.shortcut} /> : null}
                    </div>
                  ))}
                </div>
              ))}
              {items.length === 0 ? (
                <p className="px-2 py-6 text-center text-[13px] text-muted">
                  {searching ? "Searching…" : "Nothing found."}
                </p>
              ) : null}
            </div>
            <p role="status" className="sr-only">
              {searching ? "Searching" : `${items.length} results`}
            </p>
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2 text-[11px] text-muted">
              <span>↑ ↓ to move · Enter to open · Esc to close</span>
              <button type="button" className="hover:text-ink" onClick={() => show("help")}>
                Keyboard shortcuts
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {help ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={helpTitle}
            className="max-h-[76vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-2xl shadow-black/50"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id={helpTitle} className="text-[15px] font-semibold">
                Keyboard shortcuts
              </h2>
              <button
                id={closeId}
                autoFocus
                type="button"
                onClick={close}
                className="rounded-md border border-line-strong px-2.5 py-1 text-xs hover:text-ink"
              >
                Close
              </button>
            </div>
            <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 text-[13px]">
              <dt>
                <Keys keys="Ctrl K" />
              </dt>
              <dd className="text-muted">Search, or jump anywhere (⌘ K on a Mac)</dd>
              <dt>
                <Keys keys="?" />
              </dt>
              <dd className="text-muted">This list</dd>
              {COMMANDS.filter((command) => command.shortcut).map((command) => (
                <div key={command.id} className="contents">
                  <dt>
                    <Keys keys={command.shortcut!} />
                  </dt>
                  <dd className="text-muted">{command.label}</dd>
                </div>
              ))}
              {PAGE_SHORTCUTS.map((shortcut) => (
                <div key={shortcut.keys} className="contents">
                  <dt>
                    <Keys keys={shortcut.keys.replace(" / ", "/")} />
                  </dt>
                  <dd className="text-muted">{shortcut.action}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      ) : null}
    </>
  );
}
