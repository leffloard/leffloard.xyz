# Architecture

leffloard.xyz v2 is one Next.js application: the public site, the client portal and the admin system that
runs the owner's daily work (inquiries, clients, projects, meetings, quotes, invoices, payments, content).
It replaces the v1 Vite frontend and FastAPI backend, which stay in `frontend/` and `backend/` until the
cut-over (milestone M4) and are deleted 14 days after it.

This document grows with each milestone. Current state: **M1, security core and admin shell**.

## Layout

```text
app/                      Routes (App Router)
  (public)/               Public site, with its own root layout
  (admin)/admin/          Admin, with its own root layout (dynamic, noindex)
    login/, setup/        Sign-in, two-step check, first-time authenticator setup
    (shell)/              Signed-in pages: Today, Security
  api/health/route.ts     Health check (shallow and deep)
  api/csp-report/route.ts Receives Content Security Policy violation reports
  global-not-found.tsx    404 page for every unmatched address
  globals.css             Tailwind 4 entry and design tokens
components/               UI: ui/ (buttons, fields, cards) and admin/
lib/                      Pure helpers usable anywhere: TOTP, base32, IP keys, CSP builder, formatting
server/                   Server-only code (every file imports "server-only")
  env.ts                  Validated configuration, plain-English errors
  boot.ts                 Runs once at start-up (via instrumentation.ts); stops on bad config
  clock.ts                Injectable time source
  log.ts                  pino logger with secret redaction
  health.ts               Deep health logic and constant-time token check
  http.ts                 Size-limited request body reading
  auth/                   Owner account, sessions, sign-in steps, passkeys, audit log, admin action wrapper
  security/               Password hashing, encryption, rate limits, lockouts, Turnstile, Access, CSRF, NoSQL guard
  db/client.ts            One MongoClient per process
  db/migrate.ts           Migration runner with a database lock
  db/migrations/          The ordered migration list
  db/url.ts               Connection-string redaction for messages
scripts/                  dev-db, migrate, admin, start, e2e-server (run with tsx)
tests/
  unit/                   No I/O
  integration/            Real MongoDB replica set per run
  e2e/                    Playwright against the production (standalone) build
  test_requests_api.py    v1 backend tests; the spec for the intake port in M3
instrumentation.ts        Calls boot() on the Node.js runtime
proxy.ts                  Request ids and CSP headers with per-request nonces. Never authorization.
next.config.ts            Standalone output, security headers
```

## Request flow

1. `proxy.ts` gives each request an `x-request-id` and its Content Security Policy. Pages rendered per request
   (admin, and later the portal and link pages) get a fresh nonce.
2. The page or route handler runs. Public pages are prerendered at build time; admin pages are dynamic.
3. Authorization happens inside each page, route handler and server action, through the data access layer
   (`server/auth/dal.ts`). The proxy is not a security boundary: a request that skips it gains nothing.

Public endpoints are route handlers (stable URLs, easy to test). Server actions are only used for signed-in
mutations, and every admin action is built with `adminAction()` (`server/auth/action.ts`).

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

## Admin sign-in and security

There is one account, the owner, created on the server with `npm run admin -- create`. Everything below is
enforced on the server and covered by unit, integration and browser tests.

| Threat                          | Defence                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Password guessing               | argon2id (19 MiB, 2 passes); unknown emails are checked against a dummy hash, so both answers take as long. 20 attempts per 15 minutes per address. Progressive lock per email address: 15 minutes from the 5th failure, 1 hour from the 10th, 24 hours from the 20th; failures are forgotten after a quiet day. Unknown addresses lock the same way, so locks reveal nothing. |
| Stolen password                 | Every password sign-in needs a second factor: an authenticator app (TOTP, one-step drift, each code accepted once) or a single-use recovery code (10, stored as keyed hashes). The first sign-in sets up the authenticator before any session exists.                                                                                                                          |
| Locking the owner out           | Passkeys (WebAuthn, user verification required) count as both factors and ignore the password lock. The server console can reset the password or the second factors (`npm run admin`).                                                                                                                                                                                         |
| Stolen session cookie           | 256-bit random tokens; only their SHA-256 is stored. `__Host-` cookies (Secure, HttpOnly, SameSite=Lax, whole site). Sessions end after 30 idle minutes and 12 hours at most, can be signed out from the Security page, and all others end when the password or authenticator changes.                                                                                         |
| Actions from a hijacked session | Changing the password, authenticator, recovery codes or passkeys needs "confirm it's you" (password + code, or a passkey), valid for 10 minutes.                                                                                                                                                                                                                               |
| Secrets in a database copy      | Authenticator secrets are encrypted with AES-256-GCM (`DATA_ENCRYPTION_KEYS`, numbered for rotation) and bound to their record; recovery codes are HMAC'd with a key derived from it.                                                                                                                                                                                          |
| Bots                            | Cloudflare Turnstile on the sign-in form (fails closed when Cloudflare cannot confirm).                                                                                                                                                                                                                                                                                        |
| Reaching /admin at all          | Optional Cloudflare Access in front of `/admin`; when configured, the app also verifies the Access JWT on every admin request.                                                                                                                                                                                                                                                 |
| CSRF                            | Next.js checks the Origin of server actions; route handlers that change data use `isSameOriginRequest()`. Sign-in cookies are SameSite=Strict.                                                                                                                                                                                                                                 |
| NoSQL injection                 | Inputs are parsed with strict zod schemas; keys starting with `$`, containing `.` or named `__proto__` are refused first.                                                                                                                                                                                                                                                      |
| Audit                           | Sign-ins, failures, locks and every security change are written to `audit_log` and shown on the Security page.                                                                                                                                                                                                                                                                 |

### Content Security Policy and headers

Admin pages get `script-src 'self' 'nonce-…' 'strict-dynamic'` with a new nonce per request: an injected
script cannot run. Prerendered public pages cannot carry a nonce, so they allow inline scripts but no script
from anywhere except this site and Turnstile. Both policies forbid framing, plugins and `<base>`, and report
violations to `/api/csp-report` (size-limited, rate-limited, stored for 30 days without link tokens). The
browser tests fail on any CSP violation.

`next.config.ts` also sends `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`,
`Cross-Origin-Resource-Policy: same-origin`, a `Permissions-Policy` that turns off camera, microphone,
location, payment, USB and topics, and HSTS in production. `X-Powered-By` is off; admin pages add
`X-Robots-Tag: noindex, nofollow`.

### Recovery

| Situation                           | What to do                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| Lost phone, recovery codes at hand  | Sign in with a recovery code, then Security → Move to a new phone.                            |
| Lost phone and codes, passkey works | Sign in with the passkey, then replace the authenticator and create new codes.                |
| Everything lost                     | On the server: `npm run admin -- reset-2fa`, then sign in with the password and set up again. |
| Forgot the password                 | On the server: `npm run admin -- reset-password`.                                             |
| Locked out by someone guessing      | Wait, use a passkey, or `npm run admin -- unlock`.                                            |

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

| Package                                             | Why                                                                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `next` (pinned)                                     | Framework: App Router, route handlers, standalone output. Pinned exactly so security releases are applied on purpose. |
| `react`, `react-dom` (pinned)                       | The versions this Next.js release is tested with.                                                                     |
| `mongodb`                                           | Official driver; transactions, explicit queries, no ORM layer.                                                        |
| `zod`                                               | Validation of configuration and every input; one schema for client and server.                                        |
| `pino`                                              | Fast structured logs with redaction.                                                                                  |
| `geist`                                             | Geist Sans and Mono, self-hosted through `next/font` (no third-party font requests).                                  |
| `server-only`                                       | Build error if server code is imported into a client component.                                                       |
| `typescript`, `@types/*`                            | Strict types (`strict`, `noUncheckedIndexedAccess`).                                                                  |
| `eslint`, `eslint-config-next`                      | Next.js, React and TypeScript lint rules.                                                                             |
| `prettier`, `prettier-plugin-tailwindcss`           | One formatting style; sorted class names.                                                                             |
| `tailwindcss`, `@tailwindcss/postcss`               | Styling. Only `app/` and `components/` are scanned, never `frontend/`.                                                |
| `vitest`                                            | Unit and integration tests.                                                                                           |
| `mongodb-memory-server`                             | Real `mongod` replica sets for development and tests, on Windows and Linux, without Docker.                           |
| `@playwright/test`                                  | End-to-end browser tests.                                                                                             |
| `tsx`                                               | Runs the TypeScript scripts in `scripts/`.                                                                            |
| `@next/env`                                         | Loads `.env*` files in scripts exactly like Next.js does.                                                             |
| `@node-rs/argon2`                                   | argon2id password hashing with prebuilt binaries for Windows and Linux (no compiler needed).                          |
| `@simplewebauthn/server`, `@simplewebauthn/browser` | Passkeys: the WebAuthn ceremonies and their verification.                                                             |
| `jose`                                              | Verifies the Cloudflare Access JWT against Access's published keys.                                                   |
| `qrcode`                                            | The QR code for setting up the authenticator app, rendered on the server as SVG.                                      |

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
7. **Opaque sessions in MongoDB instead of JWTs.** A session can be listed, signed out and expired on the
   server at once; the cookie holds only a random token.
8. **TOTP implemented in `lib/totp.ts`** (about 60 lines, tested against the RFC 6238 vectors) instead of a
   dependency, because it is small, stable and security-critical enough to be read in full.
