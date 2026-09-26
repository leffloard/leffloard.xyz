<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# leffloard.xyz v2

Personal site and private business system of Mert Kaan Koparan (independent developer, Denizli, Turkey).
One Next.js app at the repository root. `frontend/` (Vite) and `backend/` (FastAPI) are the v1 site; they
stay untouched until the cut-over and are removed 14 days after it. `docs/ARCHITECTURE.md` explains the
design and every dependency.

## Commands

| Task                             | Command                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| Local database (keep it running) | `npm run dev:db`                                                                     |
| Development server               | `npm run dev`                                                                        |
| Apply migrations to `MONGO_URL`  | `npm run migrate` (`-- --status` to only list them)                                  |
| Checks                           | `npm run format:check`, `npm run lint`, `npm run typecheck`                          |
| Tests                            | `npm run test:unit`, `npm run test:integration`, `npm run build && npm run test:e2e` |

Machines that cannot download MongoDB or Playwright's Chromium can point the tests at local binaries with
`MONGOMS_SYSTEM_BINARY=/path/to/mongod` and `PW_CHROMIUM_PATH=/path/to/chrome`.

## Rules

- All user-facing text (site, client portal, admin) is English.
- Server code lives in `server/` and starts with `import "server-only"`. Configuration is read only through
  `getEnv()` in `server/env.ts`; time through `now()` in `server/clock.ts`; logging through `server/log.ts`.
- Authorization never lives in `proxy.ts`. Every page, route handler and action checks access itself.
- Database access goes through the official `mongodb` driver with explicit projections. Validate input with
  strict zod schemas; never build queries from unvalidated objects.
- Migrations in `server/db/migrations` are forward-only, additive and safe to run twice. Never edit or reorder
  one that has shipped; add a new one.
- Secrets never go into the repository, logs, error messages or `NEXT_PUBLIC_` variables.
- Every change comes with tests. Unit tests need no database; integration tests use the throwaway replica set
  from `tests/integration/global-setup.ts`.
- Content scope: no case studies, marketing copy or pricing for game-modification projects or cheat loaders.
