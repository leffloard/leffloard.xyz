import "server-only";
import type { Db } from "mongodb";
import { now } from "@/server/clock";
import { findLeaks, type LeakFinding } from "@/lib/content/leaks";
import { githubRepos } from "@/server/content/collections";
import { getContentSettings } from "@/server/content/editor";
import { forgetContent } from "@/server/content/snapshot";
import { bumpGeneration } from "@/server/content/store";
import type { GithubRepoDoc } from "@/server/content/types";
import { runJob, type JobOutcome } from "@/server/jobs/runner";

// The owner's public GitHub repositories, read from GitHub's API every six hours (and on "Sync now"), for the
// work page's open-source list and the stars on case studies. Only public repositories come back from this
// API; one made private or deleted disappears from here at the next sync. A new repository is not shown on
// the site until the owner ticks it.

export const GITHUB_USER = "leffloard";
const MAX_PAGES = 10;

type GithubStateDoc = {
  _id: "github";
  etag: string | null;
  lastSyncAt: Date | null;
  lastOk: boolean;
  lastResult: string;
};

type ApiRepo = {
  name?: unknown;
  html_url?: unknown;
  description?: unknown;
  language?: unknown;
  stargazers_count?: unknown;
  forks_count?: unknown;
  topics?: unknown;
  pushed_at?: unknown;
  archived?: unknown;
  fork?: unknown;
  private?: unknown;
};

function githubState(db: Db) {
  return db.collection<GithubStateDoc>("settings");
}

export async function getGithubState(db: Db): Promise<Omit<GithubStateDoc, "_id" | "etag"> | null> {
  const doc = await githubState(db).findOne({ _id: "github" }, { projection: { etag: 0 } });
  return doc ? { lastSyncAt: doc.lastSyncAt, lastOk: doc.lastOk, lastResult: doc.lastResult } : null;
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;

function repoDoc(repo: ApiRepo, at: Date): Omit<GithubRepoDoc, "show"> | null {
  const name = text(repo.name, 100);
  if (!/^[\w.-]+$/.test(name) || repo.private === true) return null;
  const pushedAt = typeof repo.pushed_at === "string" ? new Date(repo.pushed_at) : null;
  return {
    _id: name.toLowerCase(),
    name,
    url: `https://github.com/${GITHUB_USER}/${name}`,
    description: text(repo.description, 300),
    language: text(repo.language, 40) || null,
    stars: count(repo.stargazers_count),
    forks: count(repo.forks_count),
    topics: Array.isArray(repo.topics)
      ? repo.topics
          .map((topic) => text(topic, 50))
          .filter(Boolean)
          .slice(0, 12)
      : [],
    pushedAt: pushedAt && !Number.isNaN(pushedAt.getTime()) ? pushedAt : null,
    archived: repo.archived === true,
    fork: repo.fork === true,
    syncedAt: at,
  };
}

export type SyncResult = { ok: boolean; message: string };

async function record(db: Db, result: SyncResult, at: Date, etag?: string | null): Promise<SyncResult> {
  await githubState(db).updateOne(
    { _id: "github" },
    {
      $set: {
        lastSyncAt: at,
        lastOk: result.ok,
        lastResult: result.message,
        ...(etag !== undefined ? { etag } : {}),
      },
      $setOnInsert: etag === undefined ? { etag: null } : {},
    },
    { upsert: true },
  );
  return result;
}

export async function syncGithub(
  db: Db,
  options: { apiUrl: string; token?: string; fetch?: typeof fetch },
  at: Date = now(),
): Promise<SyncResult> {
  const state = await githubState(db).findOne({ _id: "github" });
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "leffloard.xyz",
  };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (state?.etag) headers["if-none-match"] = state.etag;

  // Page after page (GitHub gives at most 100 a page), following its "next" links; nothing is removed
  // unless every page was read.
  const repos: ApiRepo[] = [];
  let url: string | null = `${options.apiUrl}/users/${GITHUB_USER}/repos?type=owner&sort=pushed&per_page=100`;
  let etag: string | null = null;
  const laterHeaders = Object.fromEntries(
    Object.entries(headers).filter(([name]) => name !== "if-none-match"),
  );
  for (let page = 1; url && page <= MAX_PAGES; page += 1) {
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(url, {
        headers: page === 1 ? headers : laterHeaders,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return record(db, { ok: false, message: "GitHub could not be reached. It tries again later." }, at);
    }
    if (page === 1 && response.status === 304) return record(db, { ok: true, message: "Up to date." }, at);
    if (!response.ok) {
      const limited = response.headers.get("x-ratelimit-remaining") === "0";
      return record(
        db,
        {
          ok: false,
          message: limited
            ? "GitHub's hourly limit is used up. It tries again later (a GITHUB_TOKEN raises the limit)."
            : `GitHub answered ${response.status}. It tries again later.`,
        },
        at,
      );
    }
    const body: unknown = await response.json().catch(() => null);
    if (!Array.isArray(body))
      return record(db, { ok: false, message: "GitHub's answer could not be read." }, at);
    repos.push(...(body as ApiRepo[]));
    if (page === 1) etag = response.headers.get("etag");
    url = nextPage(response.headers.get("link"), options.apiUrl);
  }
  if (url)
    return record(db, { ok: false, message: `More than ${MAX_PAGES * 100} repositories: not synced.` }, at);

  const docs = repos.map((repo) => repoDoc(repo, at)).filter((doc) => doc !== null);
  for (const { _id, ...fields } of docs) {
    await githubRepos(db).updateOne(
      { _id },
      { $set: fields, $setOnInsert: { show: false } },
      { upsert: true },
    );
  }
  // Gone from the public list: deleted, renamed or made private.
  await githubRepos(db).deleteMany({ _id: { $nin: docs.map((doc) => doc._id) } });
  await bumpGeneration(db, undefined, at);
  forgetContent();
  // The ETag of the first page stands for the whole list only when there is one page.
  return record(
    db,
    { ok: true, message: `${docs.length} public repositories.` },
    at,
    repos.length < 100 ? etag : null,
  );
}

// The "next" address in GitHub's Link header, if it is on the same API.
function nextPage(link: string | null, apiUrl: string): string | null {
  const next = link?.split(",").find((part) => /rel="next"/.test(part));
  const url = next ? /<([^>]+)>/.exec(next)?.[1] : undefined;
  return url && url.startsWith(`${apiUrl}/`) ? url : null;
}

export async function listRepos(db: Db): Promise<GithubRepoDoc[]> {
  return githubRepos(db).find().sort({ pushedAt: -1, _id: 1 }).limit(300).toArray();
}

export type ShowResult =
  { ok: true } | { ok: false; reason: "missing" } | { ok: false; reason: "leaks"; findings: LeakFinding[] };

// Shows a repository on the work page (after the leak check on its name and description), or hides it.
export async function setRepoShown(db: Db, id: string, show: boolean): Promise<ShowResult> {
  const repo = await githubRepos(db).findOne({ _id: id }, { projection: { name: 1, description: 1 } });
  if (!repo) return { ok: false, reason: "missing" };
  if (show) {
    const { bannedWords } = await getContentSettings(db);
    const findings = findLeaks(`${repo.name}\n${repo.description}`, bannedWords);
    if (findings.length) return { ok: false, reason: "leaks", findings };
  }
  const result = await githubRepos(db).updateOne({ _id: id }, { $set: { show } });
  if (result.modifiedCount) {
    await bumpGeneration(db);
    forgetContent();
  }
  return { ok: true };
}

// Every six hours, caught up at the next check after the server was off.
export function githubPeriod(at: Date): string {
  return `${at.toISOString().slice(0, 10)}T${String(Math.floor(at.getUTCHours() / 6) * 6).padStart(2, "0")}`;
}

export async function runGithubJob(
  db: Db,
  options: { apiUrl: string; token?: string },
  at: Date = now(),
): Promise<JobOutcome> {
  return runJob(
    db,
    "github-sync",
    async () => {
      const result = await syncGithub(db, options, at);
      if (!result.ok) throw new Error(result.message);
      return result.message;
    },
    { periodKey: githubPeriod(at), lockMs: 5 * 60_000, retryAfterFailureMs: 60 * 60_000 },
  );
}
