import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS, matchesCommand, PREFIXES, SHORTCUTS } from "@/lib/admin/commands";

const SHELL = path.resolve("app/(admin)/admin/(shell)");

// "/admin/content/post/new" is served by content/[kind]/new/page.tsx.
function pageExists(href: string): boolean {
  const parts = href.split("?")[0]!.split("/").filter(Boolean).slice(1);
  function walk(dir: string, rest: string[]): boolean {
    if (rest.length === 0) return existsSync(path.join(dir, "page.tsx"));
    const [head, ...tail] = rest;
    if (existsSync(path.join(dir, head!)) && walk(path.join(dir, head!), tail)) return true;
    for (const dynamic of ["[kind]", "[id]"]) {
      if (existsSync(path.join(dir, dynamic)) && walk(path.join(dir, dynamic), tail)) return true;
    }
    return false;
  }
  return walk(SHELL, parts);
}

describe("command palette commands", () => {
  it("each lead to an admin page that exists", () => {
    for (const command of COMMANDS) {
      expect(command.href.startsWith("/admin"), command.id).toBe(true);
      expect(pageExists(command.href), command.href).toBe(true);
    }
  });

  it("have unique ids and shortcuts, each a prefix key and one more", () => {
    expect(new Set(COMMANDS.map((command) => command.id)).size).toBe(COMMANDS.length);
    const shortcuts = COMMANDS.flatMap((command) => (command.shortcut ? [command.shortcut] : []));
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
    expect(SHORTCUTS.size).toBe(shortcuts.length);
    for (const shortcut of shortcuts) {
      const [prefix, key, ...rest] = shortcut.split(" ");
      expect((PREFIXES as readonly string[]).includes(prefix!), shortcut).toBe(true);
      expect(key, shortcut).toMatch(/^[a-z]$/);
      expect(rest).toEqual([]);
    }
    expect(SHORTCUTS.get("g i")).toBe("/admin/inbox");
    expect(SHORTCUTS.get("c q")).toBe("/admin/billing/quotes/new");
  });

  it("match every word typed, in the label, group or keywords", () => {
    const inbox = COMMANDS.find((command) => command.id === "go-inbox")!;
    expect(matchesCommand(inbox, "inb")).toBe(true);
    expect(matchesCommand(inbox, "go messages")).toBe(true);
    expect(matchesCommand(inbox, "inbox invoices")).toBe(false);
  });
});
