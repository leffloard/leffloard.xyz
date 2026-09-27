import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetClock, setClock } from "@/server/clock";
import { saveContentSettings } from "@/server/content/editor";
import { githubPeriod, getGithubState, listRepos, setRepoShown, syncGithub } from "@/server/content/github";
import { seedContent } from "@/server/content/seed";
import { contentGeneration, loadContent } from "@/server/content/store";
import { closeClient } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

const { db, url, name } = setupTestDb();
setupTestEnv({ MONGO_URL: url, DB_NAME: name });

const NOW = new Date("2026-09-28T06:00:00Z");

beforeEach(async () => {
  await runMigrations(db());
  setClock(() => NOW);
});

afterEach(() => resetClock());

afterAll(async () => {
  await closeClient();
});

const repo = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  html_url: `https://github.com/leffloard/${name}`,
  description: `About ${name}`,
  language: "TypeScript",
  stargazers_count: 3,
  forks_count: 1,
  topics: ["web"],
  pushed_at: "2026-09-20T10:00:00Z",
  archived: false,
  fork: false,
  private: false,
  ...extra,
});

// GitHub, played by a list of answers; records what it was asked.
function github(...answers: Response[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    return answers.shift() ?? new Response("gone", { status: 500 });
  }) as typeof fetch;
  return { fetch: fetchStub, calls };
}

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });

describe("the GitHub sync", () => {
  it("keeps the public repositories, remembers the owner's choices, and asks again with the ETag", async () => {
    await seedContent(db(), NOW);
    const first = github(
      json(
        [
          repo("MiniEngine", { stargazers_count: 12 }),
          repo("secret-tool", { private: true }),
          repo("CardTrack"),
        ],
        {
          etag: '"v1"',
        },
      ),
    );
    expect(
      await syncGithub(db(), { apiUrl: "https://api.github.test", token: "tok", fetch: first.fetch }, NOW),
    ).toEqual({
      ok: true,
      message: "2 public repositories.",
    });
    expect(first.calls[0]).toMatchObject({
      url: "https://api.github.test/users/leffloard/repos?type=owner&sort=pushed&per_page=100",
      headers: { authorization: "Bearer tok", "x-github-api-version": "2022-11-28" },
    });
    expect((await listRepos(db())).map((item) => [item.name, item.show])).toEqual([
      ["CardTrack", false],
      ["MiniEngine", false],
    ]);

    // Stars show on the case study at once; the list shows only what the owner ticked.
    const before = await loadContent(db(), "published");
    expect(before.repoStats["https://github.com/leffloard/miniengine"]).toEqual({
      stars: 12,
      pushedAt: "2026-09-20",
    });
    expect(before.repos).toEqual([]);
    const generation = await contentGeneration(db());
    expect(await setRepoShown(db(), "cardtrack", true)).toEqual({ ok: true });
    expect(await contentGeneration(db())).toBe((generation ?? 0) + 1);
    expect((await loadContent(db(), "published")).repos.map((item) => item.name)).toEqual(["CardTrack"]);

    // Nothing changed: GitHub says so with 304, and the choices stay.
    const second = github(new Response(null, { status: 304 }));
    expect(
      (await syncGithub(db(), { apiUrl: "https://api.github.test", fetch: second.fetch }, NOW)).message,
    ).toBe("Up to date.");
    expect(second.calls[0]!.headers["if-none-match"]).toBe('"v1"');

    // A repository made private or deleted leaves the list; a choice survives a sync.
    const third = github(json([repo("CardTrack", { stargazers_count: 5 })], { etag: '"v2"' }));
    await syncGithub(db(), { apiUrl: "https://api.github.test", fetch: third.fetch }, NOW);
    expect((await listRepos(db())).map((item) => [item.name, item.stars, item.show])).toEqual([
      ["CardTrack", 5, true],
    ]);
  });

  it("shows a repository only if its name and description pass the leak check", async () => {
    await seedContent(db(), NOW);
    await saveContentSettings(db(), ["Initech"], 0, NOW);
    const answer = github(json([repo("billing-bot", { description: "Invoices for Initech's Discord" })]));
    await syncGithub(db(), { apiUrl: "https://api.github.test", fetch: answer.fetch }, NOW);
    expect(await setRepoShown(db(), "billing-bot", true)).toEqual({
      ok: false,
      reason: "leaks",
      findings: [{ rule: "banned-word", label: "A word on your list", excerpt: "Initech" }],
    });
    expect(await setRepoShown(db(), "missing", true)).toEqual({ ok: false, reason: "missing" });
    expect((await listRepos(db()))[0]?.show).toBe(false);
  });

  it("reads every page before removing anything", async () => {
    const first = Array.from({ length: 100 }, (_, index) => repo(`repo-${index}`));
    const paged = github(
      json(first, {
        link: '<https://api.github.test/user/1/repos?page=2>; rel="next", <x>; rel="last"',
        etag: '"p1"',
      }),
      json([repo("repo-100")]),
    );
    expect(
      (await syncGithub(db(), { apiUrl: "https://api.github.test", fetch: paged.fetch }, NOW)).message,
    ).toBe("101 public repositories.");
    expect(paged.calls[1]!.url).toBe("https://api.github.test/user/1/repos?page=2");

    // A failed second page removes nothing.
    const broken = github(
      json(first.slice(0, 100), { link: '<https://api.github.test/user/1/repos?page=2>; rel="next"' }),
      new Response("oops", { status: 502 }),
    );
    expect((await syncGithub(db(), { apiUrl: "https://api.github.test", fetch: broken.fetch }, NOW)).ok).toBe(
      false,
    );
    expect(await listRepos(db())).toHaveLength(101);
  });

  it("records failures without touching the list", async () => {
    const limited = github(new Response("limit", { status: 403, headers: { "x-ratelimit-remaining": "0" } }));
    const result = await syncGithub(db(), { apiUrl: "https://api.github.test", fetch: limited.fetch }, NOW);
    expect(result).toEqual({
      ok: false,
      message: "GitHub's hourly limit is used up. It tries again later (a GITHUB_TOKEN raises the limit).",
    });
    expect(await getGithubState(db())).toMatchObject({ lastOk: false, lastSyncAt: NOW });
    const unreachable = { fetch: (async () => Promise.reject(new Error("offline"))) as typeof fetch };
    expect((await syncGithub(db(), { apiUrl: "https://api.github.test", ...unreachable }, NOW)).ok).toBe(
      false,
    );
    expect(await listRepos(db())).toEqual([]);
  });

  it("runs every six hours", () => {
    expect(githubPeriod(new Date("2026-09-28T05:59:00Z"))).toBe("2026-09-28T00");
    expect(githubPeriod(new Date("2026-09-28T06:00:00Z"))).toBe("2026-09-28T06");
    expect(githubPeriod(new Date("2026-09-28T23:10:00Z"))).toBe("2026-09-28T18");
  });
});
