import "server-only";
import { cache } from "react";
import type { SiteContent } from "@/lib/content/types";
import { getDb } from "@/server/db/client";
import { log } from "@/server/log";
import { previewing } from "@/server/content/preview";
import { seedContent } from "@/server/content/seed";
import { holder, type Holder, type Snapshot } from "@/server/content/snapshot";
import { contentGeneration, loadContent } from "@/server/content/store";

// The published content every public page reads. Each server process keeps one copy in memory and asks the
// database at most every few seconds whether it changed (the content's generation), so a page costs no
// query, and an edit shows within seconds in every process (at once in the one that made it).

const CHECK_EVERY_MS = 3_000;
const RETRY_AFTER_FAILURE_MS = 30_000;

async function refresh(current: Holder): Promise<Snapshot> {
  const db = await getDb();
  let generation = await contentGeneration(db);
  if (generation === null) {
    await seedContent(db);
    generation = (await contentGeneration(db)) ?? 0;
  }
  if (current.snapshot && current.snapshot.generation === generation) {
    current.snapshot.checkedAt = Date.now();
    return current.snapshot;
  }
  // Read after the generation: a change in between makes the next check load again, never miss it.
  const content = await loadContent(db, "published");
  current.snapshot = { content, generation, checkedAt: Date.now() };
  return current.snapshot;
}

export { forgetContent } from "@/server/content/snapshot";

export async function publishedContent(): Promise<SiteContent> {
  const current = holder();
  if (current.snapshot && Date.now() - current.snapshot.checkedAt < CHECK_EVERY_MS) {
    return current.snapshot.content;
  }
  current.loading ??= refresh(current).finally(() => {
    current.loading = null;
  });
  try {
    return (await current.loading).content;
  } catch (error) {
    // The database is unreachable: keep showing the last copy rather than an error page, and ask again only
    // after a while, so visitors don't each wait for the database's timeout meanwhile.
    if (current.snapshot) {
      log.error({ err: error }, "content: reload failed, showing the last copy");
      current.snapshot.checkedAt = Date.now() + RETRY_AFTER_FAILURE_MS - CHECK_EVERY_MS;
      return current.snapshot.content;
    }
    throw error;
  }
}

// What a public page shows: the published content, or the drafts while the owner previews them.
export const pageContent = cache(async (): Promise<SiteContent> => {
  if (await previewing()) return loadContent(await getDb(), "draft");
  return publishedContent();
});
