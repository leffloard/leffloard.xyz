import "server-only";
import type { ClientSession, Db } from "mongodb";
import type { ContentKind } from "@/lib/content/schemas";
import type { Repo, SiteContent, Stored, Testimonial } from "@/lib/content/types";
import { now } from "@/server/clock";
import { contentItems, contentState, githubRepos } from "@/server/content/collections";
import type { ContentDoc } from "@/server/content/types";

// Reading the site's content: the published copies for visitors, or the drafts for the owner's preview.

type Copy = "published" | "draft";

function byRank(a: { rank: string }, b: { rank: string }): number {
  return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
}

function copies<K extends ContentKind>(docs: ContentDoc[], kind: K, copy: Copy): Stored[K][] {
  return docs
    .filter((doc) => doc.kind === kind)
    .sort(byRank)
    .map((doc) => (copy === "published" ? doc.published : doc.draft) as Stored[K] | null)
    .filter((data): data is Stored[K] => data !== null);
}

function single<K extends "profile" | "cv" | "pricing">(docs: ContentDoc[], kind: K, copy: Copy): Stored[K] {
  const found = copies(docs, kind, copy)[0];
  if (!found) throw new Error(`The site's ${kind} is missing from the content collection.`);
  return found;
}

export async function loadContent(db: Db, copy: Copy): Promise<SiteContent> {
  const [docs, repoDocs] = await Promise.all([
    contentItems(db)
      .find(copy === "published" ? { published: { $ne: null } } : {})
      .limit(2000)
      .toArray(),
    githubRepos(db).find().sort({ pushedAt: -1, _id: 1 }).limit(300).toArray(),
  ]);
  const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);
  const repos: Repo[] = repoDocs
    .filter((repo) => repo.show)
    .map((repo) => ({
      name: repo.name,
      url: repo.url,
      description: repo.description,
      language: repo.language,
      stars: repo.stars,
      pushedAt: day(repo.pushedAt),
    }));
  const repoStats = Object.fromEntries(
    repoDocs.map((repo) => [repo.url.toLowerCase(), { stars: repo.stars, pushedAt: day(repo.pushedAt) }]),
  );
  const testimonials: Testimonial[] = docs
    .filter((doc) => doc.kind === "testimonial")
    .sort(byRank)
    .flatMap((doc) => {
      const data = (copy === "published" ? doc.published : doc.draft) as Stored["testimonial"] | null;
      // Shown only with the person's permission, and never with the note about it.
      return data?.consent
        ? [
            {
              id: doc._id.toHexString(),
              quote: data.quote,
              name: data.name,
              role: data.role,
              workSlug: data.workSlug,
            },
          ]
        : [];
    });
  return {
    profile: single(docs, "profile", copy),
    cv: single(docs, "cv", copy),
    pricing: single(docs, "pricing", copy),
    work: copies(docs, "work", copy),
    posts: copies(docs, "post", copy).sort((a, b) => b.date.localeCompare(a.date)),
    services: copies(docs, "service", copy),
    testimonials,
    repos,
    repoStats,
  };
}

export async function contentGeneration(db: Db): Promise<number | null> {
  const state = await contentState(db).findOne({ _id: "site" }, { projection: { generation: 1 } });
  return state?.generation ?? null;
}

// Every change to what visitors see raises the generation, so each server process reloads its copy.
export async function bumpGeneration(db: Db, session?: ClientSession, at: Date = now()): Promise<void> {
  await contentState(db).updateOne(
    { _id: "site" },
    { $inc: { generation: 1 }, $set: { updatedAt: at } },
    { session },
  );
}
