# Architecture

leffloard.xyz v2 is one Next.js application: the public site, the client portal and the admin system that
runs the owner's daily work (inquiries, clients, projects, meetings, quotes, invoices, payments, content).
It replaces the v1 Vite frontend and FastAPI backend, which stay in `frontend/` and `backend/` until the
cut-over (milestone M4) and are deleted 14 days after it.

This document grows with each milestone. Current state: **M4, going live: backups, background jobs and deploys**.

## Layout

```text
app/                      Routes (App Router)
  (public)/               Public site, with its own root layout: home, work, services, pricing, about, cv,
                          blog, contact, legal pages, colophon; OG images, cv.pdf and the RSS feed
  sitemap.ts, robots.ts   Machine-readable files (plus manifest.ts and .well-known/security.txt)
  (admin)/admin/          Admin, with its own root layout (dynamic, noindex)
    login/, setup/        Sign-in, two-step check, first-time authenticator setup
    (shell)/              Signed-in pages: Today, Inbox, Security, Settings
  api/inquiries/route.ts  The contact form's endpoint
  api/requests/route.ts   The v1 form API, same contract as v1 (kept until the legacy code is removed)
  api/[[...path]]/        JSON 404 for unknown API addresses
  api/health/route.ts     Health check (shallow and deep)
  api/csp-report/route.ts Receives Content Security Policy violation reports
  global-not-found.tsx    404 page for every unmatched address
  globals.css             Tailwind 4 entry and design tokens
components/               UI: ui/ (buttons, fields, cards), site/ (public site) and admin/
content/                  Public site content until the CMS (M9): site facts, work, services, CV, blog posts
lib/                      Pure helpers usable anywhere: TOTP, base32, IP keys, CSP builder, formatting
  intake/                 The form rules shared by browser and server (ported from the v1 backend)
server/                   Server-only code (every file imports "server-only")
  env.ts                  Validated configuration, plain-English errors
  boot.ts                 Runs once at start-up (via instrumentation.ts); stops on bad config
  clock.ts                Injectable time source
  log.ts                  pino logger with secret redaction
  health.ts               Deep health logic and constant-time token check
  http.ts                 Size-limited request body reading
  auth/                   Owner account, sessions, sign-in steps, passkeys, audit log, admin action wrapper
  content/                Blog rendering (Markdown pipeline), OG image and CV PDF generation
  security/               Password hashing, encryption, rate limits, lockouts, Turnstile, Access, CSRF, NoSQL guard,
                          idempotency keys
  inquiries/              The inbox: storing, listing and changing messages, the blocklist, the v1 data copy
  notify/                 Notification channels, templates, escaping, the outbox, SMTP and Discord senders
  jobs/                   Background jobs inside the server process (croner), with once-per-period runs
  backup/                 Encrypted backups (gzip + AES-256-GCM), restore with a check first
  db/client.ts            One MongoClient per process
  db/migrate.ts           Migration runner with a database lock
  db/migrations/          The ordered migration list
  db/url.ts               Connection-string redaction for messages
scripts/                  dev-db, migrate, migrate-legacy, backup, restore, admin, start, e2e-server (tsx)
deploy/                   start-production.cjs (the service's launcher) and the Windows scripts: install,
                          deploy, rollback, smoke, app (see docs/DEPLOY.md)
tests/
  unit/                   No I/O
  integration/            Real MongoDB replica set per run
  e2e/                    Playwright against the production (standalone) build
  test_requests_api.py    v1 backend tests, the spec for the intake
  legacy-parity.md        Where each of the 160 v1 test cases is checked now
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

## Public site

### Content

Until the CMS arrives (M9), the public site's content lives in `content/`: `site.ts` (contact details,
availability), `work.ts` (portfolio), `services.ts` (packages, prices, terms), `cv.ts` and `blog/*.md`.
Everything is generated at build time; no public page touches the database.

The content follows fixed rules, checked by `tests/unit/content.test.ts` on every change:

- Only verifiable facts. Private projects are described from a facts sheet (purpose, capabilities,
  architecture, practices, stack) and never link to their code; public repositories do.
- No phone numbers, template leftovers, Discord ids, webhook URLs or keys anywhere in `content/`.
- No case studies, marketing copy or pricing for game-modification projects or cheat loaders.

Blog posts are Markdown with a small frontmatter (`title`, `description`, `date`, `tags`). They are
rendered with remark and rehype, sanitised (scripts, event handlers, `javascript:` links and iframes are
removed), then highlighted by Shiki in both a light and a dark theme.

### Design system

"Engineering drawing": a near-black canvas (or near-white, following the system theme), hairline frame
lines at the edges of the content column, "+" marks where sections meet the frame, monospace annotations
("01 / Work"), one cyan accent and large Geist Sans headings. Colour tokens are CSS variables in
`app/globals.css`; every text/background pair meets WCAG AA in both themes (the lowest is 4.9:1).

Motion is limited to opacity and transform: headings rise on load, sections reveal with CSS scroll-driven
animations, cards light up around the pointer. With reduced motion nothing moves. The home page's contour
field is a WebGL2 shader (`components/site/signal-field.tsx`) that starts when the browser is idle, stays
off with reduced motion or Save-Data, pauses off-screen, and is not needed for the page to be complete.

### Search engines and sharing

Every page has a title, description and canonical URL on `https://leffloard.xyz`. Social previews are
generated images in the site's style (`opengraph-image.tsx`, per case study and post). The site publishes
`sitemap.xml`, `robots.txt` (the admin and link pages are excluded), an RSS feed, a web manifest,
`/.well-known/security.txt` and Person / BlogPosting structured data. Old v1 addresses redirect: the request
form (`/?type=…`) to `/contact`, and the template blog posts to `/blog`.

## Inbox and notifications

### Intake

Visitors write through the contact form (`POST /api/inquiries`): a three-step project brief, or a one-step
question, revision request or call request. Pages and scripts written for v1 can still use
`POST /api/requests`, with v1's exact answers (201, 422 `{detail: [{field, message}]}`, 429). Both end in
`submitInquiry()` (`server/inquiries/intake.ts`).

The field rules are a line-by-line port of v1's `schemas.py` (`lib/intake/`): the same limits (counted in code
points, like Python), whitespace, control characters, email check, IANA time zones and the call date window
in the visitor's own zone. The form runs the same code in the browser, so a mistake shows before sending.

| Protection       | How                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Bots             | Hidden honeypot field (a filled one gets a fake success and nothing is stored), then Cloudflare Turnstile on the contact form |
| Floods           | Five messages per address every ten minutes, shared by both endpoints and stored in MongoDB                                   |
| Double submits   | `Idempotency-Key`: a form sent twice is stored once, and the second answer repeats the first                                  |
| Cross-site posts | Origin and `Sec-Fetch-Site` check                                                                                             |
| Injection        | JSON only, 32 KB limit, operator-like keys refused, every field validated and length-capped                                   |
| Unwanted senders | A blocklist (address or domain) sends their messages to spam without alerts, with the usual answer                            |

### The inbox

`/admin/inbox` lists messages by view (Inbox, New, Open, Confirmed, Snoozed, Done, Declined, Spam, All), kind
and search (escaped, case-insensitive), with keyboard navigation (`j`, `k`, `/`). A message page has the
reply form, status changes (with an optional status email in v1's wording), call scheduling in the visitor's
time zone, labels, a private note, snooze and delete. Every change goes through `adminAction()`.

Retention follows the privacy notice: a TTL index deletes a message 24 months after its last activity, and
spam after 30 days. Deleting a message also deletes its queued emails, and is written to the audit log.

### Notifications

Every email and Discord message leaves through the outbox (`server/notify/outbox.ts`):

1. The message is rendered and stored first, with a `dedupeKey`, so an event can't be announced twice and a
   retry sends exactly the same text.
2. It is sent right after the response (`after()`), or by the scheduler's minute job.
3. A sender claims a message before sending, so two processes never send the same one. A failure is retried
   after 1, 5 and 30 minutes, then 2 and 12 hours; after six attempts it is marked failed and shown in
   Settings, where it can be retried.

Visitor text is escaped for each channel, with v1's rules (`server/notify/escape.ts`): Discord Markdown,
links and mentions are neutralised and `allowed_mentions` is empty; email header text is kept on one line and
RFC 2047 encoded words are defused. The webhook address is never stored, logged or shown in an error.
`EMAIL_DELIVERY=log` writes emails to the log instead (development and browser tests).

### Moving v1's data

`npm run migrate-legacy` copies v1's `requests` collection into the inbox: a dry run by default, `--apply` to
copy, `--verify` to compare. The v1 collection is only read. Each copy keeps its v1 id, so a unique index
makes a second run add only what is new, and going back to v1 stays possible.

## Operations

The runbook is [DEPLOY.md](DEPLOY.md); this is how the pieces fit.

- **Service.** NSSM runs `node C:\leffloard\current\start-production.cjs` as the virtual account
  `NT SERVICE\leffloard`. The launcher reads the settings file (readable only by that account and
  administrators), binds to 127.0.0.1 and starts Next.js's standalone `server.js`. Cloudflare Tunnel is the
  only way in.
- **Deploys** build in the checkout, assemble a release folder, back up, migrate, and start the release on a
  trial port with `BACKGROUND_JOBS=off`. Only a healthy trial is switched live (a junction), and a release
  that is unhealthy after the switch is rolled back automatically. Additive migrations keep rollbacks safe.
- **Background jobs** (`server/jobs`) run in the server process with croner. `runJob()` records each run in
  the `jobs` collection and claims it first, so two processes never run a job twice, and a periodic job that
  was due while the server was off runs at the next check.
- **Backups** (`server/backup`) are NDJSON exports (canonical Extended JSON, so every BSON type survives),
  gzipped and encrypted with AES-256-GCM under `BACKUP_KEY`, with the plain header authenticated too.
  Sessions, rate limits, the delivery log and the migration records are left out; a restore runs the
  migrations, which also rebuild the indexes. A restore decrypts and checks the whole file before writing
  anything, refuses a database that is not empty unless told to replace it, and compares every collection
  with the backup's own counts. `npm run restore -- <file> --check` is the monthly drill.
- **Health.** `/api/health?deep=1` reports configuration, database and migrations (these decide a deploy)
  and, for information, whether the last backup is recent.

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
- Every public page is checked with axe (WCAG 2.2 AA) in both themes, and for horizontal overflow at 360px.
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

| Package                                                                                         | Why                                                                                                                   |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `next` (pinned)                                                                                 | Framework: App Router, route handlers, standalone output. Pinned exactly so security releases are applied on purpose. |
| `react`, `react-dom` (pinned)                                                                   | The versions this Next.js release is tested with.                                                                     |
| `mongodb`                                                                                       | Official driver; transactions, explicit queries, no ORM layer.                                                        |
| `zod`                                                                                           | Validation of configuration and every input; one schema for client and server.                                        |
| `pino`                                                                                          | Fast structured logs with redaction.                                                                                  |
| `geist`                                                                                         | Geist Sans and Mono, self-hosted through `next/font` (no third-party font requests).                                  |
| `server-only`                                                                                   | Build error if server code is imported into a client component.                                                       |
| `typescript`, `@types/*`                                                                        | Strict types (`strict`, `noUncheckedIndexedAccess`).                                                                  |
| `eslint`, `eslint-config-next`                                                                  | Next.js, React and TypeScript lint rules.                                                                             |
| `prettier`, `prettier-plugin-tailwindcss`                                                       | One formatting style; sorted class names.                                                                             |
| `tailwindcss`, `@tailwindcss/postcss`                                                           | Styling. Only `app/` and `components/` are scanned, never `frontend/`.                                                |
| `vitest`                                                                                        | Unit and integration tests.                                                                                           |
| `mongodb-memory-server`                                                                         | Real `mongod` replica sets for development and tests, on Windows and Linux, without Docker.                           |
| `@playwright/test`                                                                              | End-to-end browser tests.                                                                                             |
| `tsx`                                                                                           | Runs the TypeScript scripts in `scripts/`.                                                                            |
| `@next/env`                                                                                     | Loads `.env*` files in scripts exactly like Next.js does.                                                             |
| `@node-rs/argon2`                                                                               | argon2id password hashing with prebuilt binaries for Windows and Linux (no compiler needed).                          |
| `@simplewebauthn/server`, `@simplewebauthn/browser`                                             | Passkeys: the WebAuthn ceremonies and their verification.                                                             |
| `jose`                                                                                          | Verifies the Cloudflare Access JWT against Access's published keys.                                                   |
| `qrcode`                                                                                        | The QR code for setting up the authenticator app, rendered on the server as SVG.                                      |
| `unified`, `remark-parse`, `remark-gfm`, `remark-rehype`, `rehype-sanitize`, `rehype-stringify` | The Markdown pipeline for blog posts, with sanitising before anything is published.                                   |
| `shiki`, `@shikijs/rehype`                                                                      | Code highlighting at build time, in a light and a dark theme, with no JavaScript sent to the browser.                 |
| `@react-pdf/renderer`                                                                           | Generates `/cv.pdf` from the same data as the CV page.                                                                |
| `@axe-core/playwright`                                                                          | Accessibility checks (WCAG 2.2 AA) in the browser tests.                                                              |
| `nodemailer`                                                                                    | Sends email over SMTP (STARTTLS, TLS or plain), with correct encoding of non-ASCII names and subjects.                |
| `croner`                                                                                        | Runs the background jobs (the outbox now; backups and digests later) without overlapping runs.                        |

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
9. **Content in code before the CMS.** The public site needed real content before the admin can edit it;
   typed files in `content/` are reviewed like code and move into the database in M9.
10. **No third-party scripts on public pages** (fonts are self-hosted, no analytics tags); Cloudflare
    Turnstile on forms is the only exception.
11. **An outbox for every outgoing message.** v1 sent alerts in a background task and only logged failures;
    a stored, deduplicated and retried message survives a slow mail server or a restart.
12. **Replies arrive in the owner's mailbox, not in the app.** Emails to visitors set Reply-To to
    `NOTIFY_EMAIL_TO`; parsing inbound mail would need a mail server or a paid service for little gain today.
13. **v1's form API stays until the legacy code is removed (M12)**, so a v1 page still open in a browser
    during the cut-over keeps working. Its answers are checked against v1's own test cases.
14. **Backups have their own key.** A copy of the backups can be kept anywhere without handing over the key
    that protects the secrets inside the database, and either key can be replaced on its own.
15. **A trial start before every switch.** The deploy proves the new release answers its deep health check
    on the real database before visitors reach it; the old release keeps serving until then.
