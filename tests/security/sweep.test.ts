import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeClient } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { setupTestDb } from "../integration/db";
import { setupTestEnv } from "../integration/env";

// Every way into the admin, tried without a session: each server action, each admin page and route handler.
// The list is read from the source tree, so a new action or route is swept without being added here.

// The request's cookies: none, or a session token the database has never seen.
const jar = vi.hoisted(() => ({ session: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name.endsWith("session") && jar.session ? { name, value: jar.session } : undefined,
    has: (name: string) => name.endsWith("session") && jar.session !== undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
  headers: async () => new Headers({ "user-agent": "security sweep", "x-forwarded-for": "203.0.113.200" }),
}));

const { db, url, name } = setupTestDb();
setupTestEnv({ MONGO_URL: url, DB_NAME: name });

beforeEach(async () => {
  await runMigrations(db());
  jar.session = undefined;
});

afterAll(async () => {
  await closeClient();
});

const APP = path.resolve("app");

function filesIn(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return filesIn(full, pattern);
    return pattern.test(entry) ? [full] : [];
  });
}

const relative = (file: string) => path.relative(process.cwd(), file).split(path.sep).join("/");
const source = (file: string) => readFileSync(file, "utf8");

// All the code a server action could live in, and the files that are actions: "use server" as the first
// statement, after any comments.
const SOURCES = ["app", "server", "components", "lib"].flatMap((dir) =>
  filesIn(path.resolve(dir), /\.(ts|tsx|js|jsx|mjs)$/),
);
const DIRECTIVE = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/;
const actionFiles = SOURCES.filter((file) => DIRECTIVE.test(source(file)));

// The sign-in steps and signing out: public by nature, and each checks what it needs itself. Named with
// their files, so the same name anywhere else is swept like any other action.
const PUBLIC_ACTIONS: Record<string, string[]> = {
  "app/(admin)/admin/(shell)/actions.ts": ["logoutAction"],
  "app/(admin)/admin/login/actions.ts": [
    "passwordLoginAction",
    "secondFactorAction",
    "setupAction",
    "passkeyLoginOptionsAction",
    "passkeyLoginAction",
  ],
};
const isPublicAction = (file: string, exported: string) =>
  PUBLIC_ACTIONS[relative(file)]?.includes(exported) ?? false;

describe("server actions", () => {
  it("are found, and the public ones are where the list says", () => {
    expect(actionFiles.length).toBeGreaterThan(10);
    for (const [file, names] of Object.entries(PUBLIC_ACTIONS)) {
      for (const exported of names) {
        expect(source(path.resolve(file)), `${file}: ${exported}`).toMatch(
          new RegExp(`^export async function ${exported}\\b`, "m"),
        );
      }
    }
  });

  it("are never declared inside other code", () => {
    // An inline "use server" makes an action that isn't in a file the sweep reads.
    const inline = SOURCES.filter((file) => {
      const found = source(file).match(/["']use server["']/g)?.length ?? 0;
      return found !== (actionFiles.includes(file) ? 1 : 0);
    });
    expect(inline.map(relative)).toEqual([]);
  });

  it("are all adminAction(), except the sign-in steps", () => {
    const problems: string[] = [];
    for (const file of actionFiles) {
      const text = source(file);
      for (const match of text.matchAll(
        /^export\s+(async\s+function|function|const|let|var|default|\{|\*)\s*(\w*)/gm,
      )) {
        const [, kind, exported] = match;
        if (kind === "const") {
          if (!new RegExp(`^export const ${exported} = adminAction\\(`, "m").test(text)) {
            problems.push(`${relative(file)}: ${exported} is not wrapped in adminAction()`);
          }
        } else if (kind?.includes("function")) {
          if (!isPublicAction(file, exported!))
            problems.push(`${relative(file)}: ${exported} is a bare function`);
        } else {
          problems.push(`${relative(file)}: exports ${kind} ${exported}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  for (const cookie of ["no session", "a forged session"] as const) {
    it(`all refuse ${cookie}`, async () => {
      jar.session = cookie === "no session" ? undefined : "forged-session-token-that-no-database-has";
      const answered: string[] = [];
      let tried = 0;
      for (const file of actionFiles) {
        const exports = (await import(file)) as Record<string, unknown>;
        for (const [exported, value] of Object.entries(exports)) {
          if (typeof value !== "function" || isPublicAction(file, exported)) continue;
          tried += 1;
          const result = (await (value as (input: unknown) => Promise<unknown>)({})) as {
            ok: boolean;
            code?: string;
          };
          if (result.ok || result.code !== "unauthorized") answered.push(`${relative(file)}: ${exported}`);
        }
      }
      expect(answered).toEqual([]);
      // Every wrapped action was really called (a module that failed to load would find none).
      const wrapped = actionFiles
        .map((file) => source(file).match(/^export const \w+ = adminAction\(/gm)?.length ?? 0)
        .reduce((sum, count) => sum + count, 0);
      expect(tried).toBe(wrapped);
      expect(tried).toBeGreaterThan(100);
    });
  }
});

describe("admin pages", () => {
  it("each check the session themselves (a layout alone isn't re-run on navigation)", () => {
    const pages = filesIn(path.join(APP, "(admin)/admin/(shell)"), /^page\.tsx$/);
    expect(pages.length).toBeGreaterThan(40);
    expect(pages.filter((file) => !/await requireAdmin\(\)/.test(source(file))).map(relative)).toEqual([]);
  });

  it("outside the shell (sign-in, setup) still go through Cloudflare Access", () => {
    const pages = filesIn(path.join(APP, "(admin)/admin"), /^page\.tsx$/).filter(
      (file) => !file.includes(`${path.sep}(shell)${path.sep}`),
    );
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.filter((file) => !/require(Admin|Access)\(\)/.test(source(file))).map(relative)).toEqual([]);
  });
});

describe("route handlers", () => {
  const routes = filesIn(APP, /^route\.(ts|tsx|js|mjs)$/);
  const adminRoutes = routes.filter((file) => file.includes(`${path.sep}(admin)${path.sep}`));
  const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
  const MUTATING = ["POST", "PUT", "PATCH", "DELETE"];
  type Handler = (...args: unknown[]) => Promise<Response>;
  // What each route file really exports, whatever way it is written.
  const handlersOf = async (file: string) => {
    const exports = (await import(file)) as Record<string, unknown>;
    return METHODS.filter((method) => typeof exports[method] === "function").map(
      (method) => [method, exports[method] as Handler] as const,
    );
  };
  const takesData = async (file: string) =>
    (await handlersOf(file)).some(([method]) => MUTATING.includes(method));
  const isCatchAll = (file: string) => file.includes("[[...");
  // Posted by others, and checked another way: NOWPayments signs its callbacks (HMAC), and browsers post
  // CSP reports, which are only counted.
  const NOT_SAME_ORIGIN = ["app/api/payments/nowpayments/route.ts", "app/api/csp-report/route.ts"];

  async function statusOf(handler: Handler, method: string, file: string): Promise<number> {
    const request = new Request("https://leffloard.test/x", {
      method,
      headers: { origin: "https://leffloard.test", "content-type": "application/json" },
      ...(MUTATING.includes(method) ? { body: "{}" } : {}),
    });
    const params = isCatchAll(file) ? { path: ["x"] } : { id: "0".repeat(24) };
    try {
      return (await handler(request, { params: Promise.resolve(params) })).status;
    } catch (error) {
      // notFound() is thrown, as Next.js handles it.
      return (error as { digest?: string }).digest?.startsWith("NEXT_HTTP_ERROR_FALLBACK;404") ? 404 : 500;
    }
  }

  it("in the admin check the session, and refuse other sites' posts", async () => {
    expect(adminRoutes.length).toBeGreaterThan(3);
    const problems: string[] = [];
    for (const file of adminRoutes) {
      const text = source(file);
      if (!/currentAdmin\(\)|requireAdmin\(\)/.test(text))
        problems.push(`${relative(file)}: no session check`);
      if ((await takesData(file)) && !/isSameOriginRequest|readJsonPost/.test(text)) {
        problems.push(`${relative(file)}: no origin check`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("in the admin answer 401 or 404 without a session, whatever the method", async () => {
    const answers: string[] = [];
    for (const file of adminRoutes) {
      for (const [method, handler] of await handlersOf(file)) {
        const status = await statusOf(handler, method, file);
        if (![401, 404].includes(status)) answers.push(`${method} ${relative(file)}: ${status}`);
      }
    }
    expect(answers).toEqual([]);
  });

  it("taking data from the public check where it comes from", async () => {
    const unchecked: string[] = [];
    let found = 0;
    for (const file of routes) {
      if (adminRoutes.includes(file) || isCatchAll(file) || !(await takesData(file))) continue;
      found += 1;
      if (NOT_SAME_ORIGIN.includes(relative(file))) continue;
      if (!/isSameOriginRequest|readJsonPost|readPortalPost/.test(source(file)))
        unchecked.push(relative(file));
    }
    expect(found).toBeGreaterThan(10);
    expect(unchecked).toEqual([]);
  });

  it("the catch-all under /api answers 404 to everything", async () => {
    const catchAll = routes.filter(isCatchAll);
    expect(catchAll.length).toBeGreaterThan(0);
    for (const file of catchAll) {
      for (const [method, handler] of await handlersOf(file)) {
        expect(await statusOf(handler, method, file), `${method} ${relative(file)}`).toBe(404);
      }
    }
  });
});
