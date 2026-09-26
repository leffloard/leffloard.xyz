import "server-only";
import type { SiteContent } from "@/lib/content/types";

// The published content one server process keeps in memory (see server/content/site.ts). On globalThis, so
// every bundle of the server shares one copy; in a module of its own, so writers can drop it without
// importing the loader.

export type Snapshot = { content: SiteContent; generation: number; checkedAt: number };
export type Holder = { snapshot: Snapshot | null; loading: Promise<Snapshot> | null };

const KEY = Symbol.for("leffloard.content");

export function holder(): Holder {
  const scope = globalThis as { [KEY]?: Holder };
  return (scope[KEY] ??= { snapshot: null, loading: null });
}

// After a change made in this process: the next page reloads at once.
export function forgetContent(): void {
  holder().snapshot = null;
}
