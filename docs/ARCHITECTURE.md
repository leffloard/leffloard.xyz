# Architecture

leffloard.xyz v2 is one Next.js application: the public site, the client portal and the admin system that
runs the owner's daily work (inquiries, clients, projects, meetings, quotes, invoices, payments, content).
It replaces the v1 Vite frontend and FastAPI backend, which stay in `frontend/` and `backend/` until the
cut-over (milestone M4) and are deleted 14 days after it.

This document grows with each milestone. Current state: **M0, foundation**.

## Layout

```text
app/                      Routes (App Router)
  (public)/               Public site, with its own root layout
  api/health/route.ts     Health check (shallow and deep)
  global-not-found.tsx    404 page for every unmatched address
  globals.css             Tailwind 4 entry and design tokens
server/                   Server-only code (every file imports "server-only")
  env.ts                  Validated configuration, plain-English errors
  boot.ts                 Runs once at start-up (via instrumentation.ts); stops on bad config
  clock.ts                Injectable time source
  log.ts                  pino logger with secret redaction
  health.ts               Deep health logic and constant-time token check
  db/client.ts            One MongoClient per process
  db/migrate.ts           Migration runner with a database lock
  db/migrations/          The ordered migration list
  db/url.ts               Connection-string redaction for messages
scripts/                  dev-db, migrate, start, e2e-server (run with tsx)
tests/
  unit/                   No I/O
  integration/            Real MongoDB replica set per run
  e2e/                    Playwright against the production (standalone) build
  test_requests_api.py    v1 backend tests; the spec for the intake port in M3
instrumentation.ts        Calls boot() on the Node.js runtime
proxy.ts                  Request ids only (later: CSP nonces). Never authorization.
next.config.ts            Standalone output, security headers
```

## Request flow

1. `proxy.ts` gives each request an `x-request-id` (on the request and the response).
2. The page or route handler runs. Static pages are prerendered at build time; admin, portal and link pages
   will be dynamic.
3. Authorization happens inside each page, route handler and server action, and again in the data-access
   functions. The proxy is not a security boundary: a request that skips it gains nothing.

Public endpoints are route handlers (stable URLs, easy to test). Server actions are only used for signed-in
mutations, through one guarded wrapper (M1).

## Configuration

`server/env.ts` validates every variable with zod when the server starts (`instrumentation.ts` →
`server/boot.ts`). A broken value stops the start with a readable list instead of a stack trace on the first
request. Messages never repeat secrets: a malformed `MONGO_URL` is shown only up to `://`.

- Development: `npm run dev:db` writes `.env.local` pointing at the local database.
- Production: the same variables come from the service environment (M4).
- Variables that only v1 used (`ADMIN_PASSWORD_HASH`, `ADMIN_JWT_SECRET`, `CORS_ORIGINS`, `FRONTEND_DIST`,
  `TRUST_PROXY`) produce a warning, not an error, so the v1 `.env` can be reused during the move.

`.env.example` documents every variable.

## Database

- Official `mongodb` driver 7, no ORM. Queries stay explicit and reviewable; zod validates what goes in.
- One client per process (`server/db/client.ts`), kept on `globalThis` so development hot reloads do not open
  new connection pools. A failed connection is forgotten, so the next request retries.
- Production uses the existing MongoDB Atlas database (`DB_NAME=leffloard`). Development and tests never do:
  `npm run dev:db` runs a local one-member replica set (transactions need a replica set) from
  `mongodb-memory-server`, with data in `.data/dev-db`. No Docker or MongoDB installation is needed; the
  first start downloads MongoDB 8.0 (the version Atlas runs), pinned in `package.json` → `config`.

### Migrations

`npm run migrate` applies `server/db/migrations` in order and records each one in `schema_migrations`.

- **Forward-only and additive.** The release before a migration must keep working on the migrated data, so a
  deploy can roll back without a down migration (expand now, contract in a later release).
- **Safe to repeat.** A migration that fails is not recorded and runs again next time.
- **One runner at a time.** A lock document in `locks` (expiring after 10 minutes, so a crashed runner cannot
  block forever) makes a second runner fail with exit code 2 instead of racing.
- The deep health check reports pending migrations, so the deploy script refuses to switch to a release whose
  migrations did not run.

## Health checks

| Request                                                       | Answer                                                                                                                                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                                             | `{"ok":true}` while the process serves requests. Public.                                                                                                                           |
| `GET /api/health?deep=1` with `x-health-token: $HEALTH_TOKEN` | Configuration, database ping and pending migrations, each `ok`/`error`/`pending`/`skipped`, with the app version. 200 when all are ok, otherwise 503. 403 without the right token. |

The token is compared in constant time (SHA-256 digests with `timingSafeEqual`). Every check has a 3-second
limit, so a hanging database cannot hang the health check.

## Logging

`server/log.ts` writes JSON lines with pino. Fields named `password`, `token`, `secret`, `authorization` and
`cookie` (top level or one level down) and request header credentials are replaced with `[redacted]`.

## Security headers

`next.config.ts` sends on every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin` and a
`Permissions-Policy` that turns off camera, microphone, location, payment, USB and topics. `X-Powered-By` is
off. CSP with per-request nonces and HSTS arrive in M1.

## Testing

| Suite       | Command                             | Needs                                                   |
| ----------- | ----------------------------------- | ------------------------------------------------------- |
| Unit        | `npm run test:unit`                 | nothing                                                 |
| Integration | `npm run test:integration`          | downloads MongoDB on first run                          |
| End-to-end  | `npm run build && npm run test:e2e` | Playwright Chromium (`npx playwright install chromium`) |

- Integration tests share one throwaway replica set per run (`tests/integration/global-setup.ts`); each test
  file gets its own database, emptied before every test.
- End-to-end tests start `scripts/e2e-server.ts`: a throwaway database with migrations applied and the
  standalone build started exactly as production starts it. Any console error or failed request on a page
  fails the test.
- Offline machines can use local binaries: `MONGOMS_SYSTEM_BINARY=/path/to/mongod`,
  `PW_CHROMIUM_PATH=/path/to/chrome`.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on `main`:

- **checks** (Ubuntu): formatting, lint, types, unit and integration tests, production build, end-to-end
  tests, `npm audit` of production dependencies.
- **windows** (Windows): types, unit and integration tests and the production build, because production runs
  on a Windows server.
- **legacy** (Ubuntu): the v1 backend's pytest suite, until v1 is removed.

Dependabot proposes npm and GitHub Actions updates weekly; `next`, `react` and their types are grouped.

## Dependencies

Every direct dependency and why it is here.

| Package                                   | Why                                                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `next` (pinned)                           | Framework: App Router, route handlers, standalone output. Pinned exactly so security releases are applied on purpose. |
| `react`, `react-dom` (pinned)             | The versions this Next.js release is tested with.                                                                     |
| `mongodb`                                 | Official driver; transactions, explicit queries, no ORM layer.                                                        |
| `zod`                                     | Validation of configuration and every input; one schema for client and server.                                        |
| `pino`                                    | Fast structured logs with redaction.                                                                                  |
| `geist`                                   | Geist Sans and Mono, self-hosted through `next/font` (no third-party font requests).                                  |
| `server-only`                             | Build error if server code is imported into a client component.                                                       |
| `typescript`, `@types/*`                  | Strict types (`strict`, `noUncheckedIndexedAccess`).                                                                  |
| `eslint`, `eslint-config-next`            | Next.js, React and TypeScript lint rules.                                                                             |
| `prettier`, `prettier-plugin-tailwindcss` | One formatting style; sorted class names.                                                                             |
| `tailwindcss`, `@tailwindcss/postcss`     | Styling. Only `app/` and `components/` are scanned, never `frontend/`.                                                |
| `vitest`                                  | Unit and integration tests.                                                                                           |
| `mongodb-memory-server`                   | Real `mongod` replica sets for development and tests, on Windows and Linux, without Docker.                           |
| `@playwright/test`                        | End-to-end browser tests.                                                                                             |
| `tsx`                                     | Runs the TypeScript scripts in `scripts/`.                                                                            |
| `@next/env`                               | Loads `.env*` files in scripts exactly like Next.js does.                                                             |

## Decisions

1. **One Next.js app instead of Next.js plus FastAPI.** The FastAPI code covered about 5% of the new scope.
   Two runtimes would mean validation written twice and a Node server anyway. Its rules and tests become the
   specification for the new intake (M3).
2. **No ORM.** The driver with zod keeps every query visible, and billing collections get `$jsonSchema`
   validators in the database itself (M7).
3. **Forward-only migrations** so every deploy can roll back by switching the release folder (M4).
4. **Local replica set instead of Atlas in development.** Atlas M0 has no backups and a throughput cap; a
   development mistake must never touch real data.
5. **Standalone output** runs as a Windows service behind a Cloudflare Tunnel (M4): no open ports, and the
   release folder contains only what the server needs.
6. **Configuration fails fast and readably.** The v1 backend printed a raw pymongo traceback for a mistyped
   `MONGO_URL`; v2 names the problem and how to fix it.
