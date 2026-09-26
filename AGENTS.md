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
| Owner account tools              | `npm run admin -- create`, `status`, `reset-password`, `reset-2fa`, `unlock`         |
| Checks                           | `npm run format:check`, `npm run lint`, `npm run typecheck`                          |
| Tests                            | `npm run test:unit`, `npm run test:integration`, `npm run build && npm run test:e2e` |

Machines that cannot download MongoDB or Playwright's Chromium can point the tests at local binaries with
`MONGOMS_SYSTEM_BINARY=/path/to/mongod` and `PW_CHROMIUM_PATH=/path/to/chrome`.

## Rules

- All user-facing text (site, client portal, admin) is English.
- Pure helpers (no I/O, safe anywhere) live in `lib/`. Server code lives in `server/` and starts with
  `import "server-only"`. Configuration is read only through
  `getEnv()` in `server/env.ts`; time through `now()` in `server/clock.ts`; logging through `server/log.ts`.
- Authorization never lives in `proxy.ts`. Every admin page calls `requireAdmin()` (layouts alone are not
  enough: they do not re-render on navigation), and every admin server action is built with `adminAction()`
  from `server/auth/action.ts`, which checks the session, "confirm it's you" (`{ sudo: true }`) and input.
- Database access goes through the official `mongodb` driver with explicit projections. Validate input with
  strict zod schemas; never build queries from unvalidated objects.
- Migrations in `server/db/migrations` are forward-only, additive and safe to run twice. Never edit or reorder
  one that has shipped; add a new one.
- Secrets never go into the repository, logs, error messages or `NEXT_PUBLIC_` variables.
- Every email and Discord message goes through the outbox (`enqueue()` in `server/notify/outbox.ts`) with a
  `dedupeKey`; never send directly from a request (the Settings test buttons are the one exception).
- Visitor text is untrusted: build Discord text with `discordSafe()` and email headers with `headerText()`
  (`server/notify/escape.ts`), and show it in the admin as plain text. The webhook address is a secret.
- Form rules live in `lib/intake/` and run in both the browser and the server; the v1 API's messages and
  status codes stay exactly as `tests/legacy-parity.md` describes.
- Money is `{ amountMinor, currency }` (whole minor units); parse, format and calculate it only with
  `lib/money.ts` (and `lib/billing/document.ts` for lines, discounts, taxes and schedules, `lib/finance/fx.ts`
  for conversions). Never multiply or divide an amount with floats, never add amounts in different
  currencies, and never convert without a stored TCMB rate. Calendar dates are `YYYY-MM-DD` strings in the
  owner's time zone; instants are `Date`s.
- Billing documents change only through `server/billing`: an issued quote or invoice is frozen (void, credit
  note or a new version instead), numbers come from `nextDocumentNumber()` inside the issuing transaction,
  and a payment and its invoice's paid amount change in one transaction. Payment states only move forward.
- A payment provider's callback is never trusted for money: check its signature, store it first
  (`payment_events`), then act only on the status read back from the provider's API and matched against our
  checkout. Anything unexpected goes to the review queue, never straight onto an invoice.
- Public quote and invoice links (`/q/`, `/i/`, `/pay/`) are secrets: 128-bit `publicId`s, noindex, no
  referrer, nonce CSP. Public pages must not call `currentAdmin()` (it audits denials); use
  `ownerCookiePresent()`.
- Admin form fields are parsed with the zod helpers in `lib/forms.ts` (they clean text like the contact form
  does). Ordered lists store a rank from `lib/rank.ts`, placed with `rankFor()` in `server/db/ordering.ts`.
- Meetings are created, moved and ended only through `server/calendar/meetings.ts`, which writes the
  meeting, its 15-minute cell locks and the day's count in one transaction. Never insert or delete meetings
  or `slot_locks` elsewhere. Open times come from `openSlots()`; a public booking must be one of them.
- A guest's manage link is a secret: store only `hashToken()` and the sealed copy, never log the link or keep
  it in other records (the development-only `EMAIL_DELIVERY=log` prints whole emails, links included), and
  keep `/meeting/` pages noindex with no referrer. A secret booking type is found only with its `linkKey`.
- The client portal reaches data only through `requirePortalClient()` / `currentPortalClient()`
  (`server/portal/dal.ts`) and queries that filter by that client's id (`server/portal/views.ts`): another
  client's record must be not found (404), never loaded and then refused. Portal sessions and admin sessions
  stay separate (their own collections and cookies); never accept one for the other.
- A portal sign-in link is spent only by the POST to `/api/portal/verify`, never by a GET (mail scanners open
  links). Store only the SHA-256 of links and session tokens, and never log them.
- Every change comes with tests. Unit tests need no database; integration tests use the throwaway replica set
  from `tests/integration/global-setup.ts`.
- Content scope: no case studies, marketing copy or pricing for game-modification projects or cheat loaders.
- Public content (`content/`) states only verifiable facts. Private projects never link to their code and
  never name customers, amounts, domains or ids. `tests/unit/content.test.ts` enforces the checkable parts.
