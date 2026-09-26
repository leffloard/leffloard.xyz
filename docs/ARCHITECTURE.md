# Architecture

leffloard.xyz v2 is one Next.js application: the public site, the client portal and the admin system that
runs the owner's daily work (inquiries, clients, projects, meetings, quotes, invoices, payments, content).
It replaces the v1 Vite frontend and FastAPI backend, which stay in `frontend/` and `backend/` until the
cut-over (milestone M4) and are deleted 14 days after it.

This document grows with each milestone. Current state: **M9, the content editor: the public site's content
in the database with drafts, previews, scheduled publishing, versions and a leak check; the media library;
the GitHub sync**.

## Layout

```text
app/                      Routes (App Router)
  (public)/               Public site, with its own root layout: home, work, services, pricing, about, cv,
                          blog, contact, book, legal pages, colophon; OG images, cv.pdf and the RSS feed
    meeting/[token]/      A guest's own page for their meeting (reschedule, cancel, invite.ics)
    q/[publicId]/         A quote's link: read it, accept or decline it, its PDF
    i/[publicId]/         An invoice's link: how to pay (bank details, crypto), its PDF
    pay/return/           Where NOWPayments sends the client back after paying
    portal/               The client portal: sign-in and its link's page, projects, invoices and quotes, calls,
                          account
  media/[file]/           Images from the media library (/media/<sha256>.webp)
  sitemap.ts, robots.ts   Machine-readable files (plus manifest.ts and .well-known/security.txt)
  (admin)/admin/          Admin, with its own root layout (dynamic, noindex)
    login/, setup/        Sign-in, two-step check, first-time authenticator setup
    preview/, media/      Starting the owner's preview of drafts; uploading an image
    (shell)/              Signed-in pages: Today, Inbox, Calendar, Tasks, Projects, Clients, Billing (quotes,
                          invoices, recurring, payments, settings), Finance (overview, expenses, rates,
                          export), Time, Content (work, blog, services, testimonials, profile, CV,
                          pricing terms, media, GitHub, leak check), Security, Settings
  api/inquiries/route.ts  The contact form's endpoint
  api/bookings/           Booking a call, and the open times of a booking type
  api/meetings/[token]/   The guest's link: open times, reschedule, cancel
  api/calendar/feed/      The owner's private calendar feed (iCalendar)
  api/quotes/[publicId]/  The client accepts or declines a quote
  api/invoices/[publicId]/checkout/  The client starts paying an invoice in crypto (a NOWPayments page)
  api/payments/nowpayments/  NOWPayments' payment callbacks (IPN)
  api/portal/             The portal: asking for a sign-in link, signing in with it, signing out, revision
                          and data requests
  api/preview/exit/       Ends the owner's preview of drafts
  api/requests/route.ts   The v1 form API, same contract as v1 (kept until the legacy code is removed)
  api/[[...path]]/        JSON 404 for unknown API addresses
  api/health/route.ts     Health check (shallow and deep)
  api/csp-report/route.ts Receives Content Security Policy violation reports
  global-not-found.tsx    404 page for every unmatched address
  globals.css             Tailwind 4 entry and design tokens
components/               UI: ui/ (buttons, fields, cards), site/ (public site) and admin/
content/                  The content a new database starts with (site facts, work, services, CV, blog posts);
                          after that, the database is the only source
lib/                      Pure helpers usable anywhere: TOTP, base32, IP keys, CSP builder, formatting, money
                          (integer minor units), ranks for ordered lists, durations, admin form schemas
  intake/                 The form rules shared by browser and server (ported from the v1 backend)
  work/                   Choices and calendar-date rules of the work modules (stages, due dates, repeats)
  booking/                The owner's hours and their rules, the slot engine, iCalendar output, the booking
                          form's rules
  billing/                Document lines, totals, discounts, taxes and payment schedules; statuses and their
                          words; IBAN checks; the billing forms; recurring dates and periods
  finance/                TCMB bulletins and exact conversions, expense categories, receivables' ages, CSV
  portal/                 The portal's form rules
  content/                The content's schemas (one per kind), the editor's field lists, the public types,
                          and the leak check
server/                   Server-only code (every file imports "server-only")
  env.ts                  Validated configuration, plain-English errors
  boot.ts                 Runs once at start-up (via instrumentation.ts); stops on bad config
  clock.ts                Injectable time source
  log.ts                  pino logger with secret redaction
  health.ts               Deep health logic and constant-time token check
  http.ts                 Size-limited request body reading
  auth/                   Owner account, sessions, sign-in steps, passkeys, audit log, admin action wrapper
  content/                The site's content: the seed, the snapshot public pages read, the editor's
                          changes, Markdown rendering, previews, the media library, the GitHub sync, OG
                          images and the CV PDF
  security/               Password hashing, encryption, rate limits, lockouts, Turnstile, Access, CSRF, NoSQL guard,
                          idempotency keys
  inquiries/              The inbox: storing, listing and changing messages, the blocklist, the v1 data copy
  clients/                Clients, their log and timeline, linking inbox messages, export and delete
  projects/               Projects, milestones, links, revision rounds
  tasks/, time/           Tasks (lists, board, checklists, repeats) and time entries (the one running timer)
  calendar/               Hours and the feed's secret, booking types, meetings and their slot locks, blocks,
                          the booking flows for guests and the owner, their emails, the feed
  billing/                Billing settings, numbering, quotes (and their acceptance), invoices, payments, the
                          NOWPayments client and its callbacks, recurring invoices, reminders, emails, PDFs
  finance/                Expenses, exchange rates (fetching and storing TCMB's bulletins), the reports and
                          the accountant's CSV
  portal/                 The client portal: sign-in links and sessions, what a signed-in client may see,
                          project updates, data requests, its emails and the owner's alerts
  pdf/                    The fonts every generated PDF uses
  work/collections.ts     The work modules' collections, so their stores do not import each other
  notify/                 Notification channels, templates, escaping, the outbox, SMTP and Discord senders
  jobs/                   Background jobs inside the server process (croner), with once-per-period runs
  backup/                 Encrypted backups (gzip + AES-256-GCM), restore with a check first
  db/client.ts            One MongoClient per process
  db/ordering.ts          Placing an item in a ranked list (boards)
  db/transaction.ts       Runs work in a transaction
  db/migrate.ts           Migration runner with a database lock
  db/migrations/          The ordered migration list
  db/url.ts               Connection-string redaction for messages
scripts/                  dev-db, migrate, migrate-legacy, backup, restore, admin, start, e2e-server (tsx);
                          lib/e2e-mocks.ts plays NOWPayments and TCMB in the end-to-end tests
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

1. `proxy.ts` gives each request an `x-request-id` and its Content Security Policy, with a fresh nonce for
   every address under the site's pages. Media library images skip the proxy and keep their own headers.
2. The page or route handler runs. Every page renders per request: public pages from the content snapshot
   (see Content editor), the admin, the portal and the link pages from the database.
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

Every page the app renders gets `script-src 'self' 'nonce-…' 'strict-dynamic'` with a new nonce per request
(since M9 the public pages too, and the 404 page, which renders per request to carry it): an injected script
cannot run. An address outside the site's page sections gets a policy without a nonce, which allows inline
scripts but no script from anywhere except this site and Turnstile. Both policies forbid framing, plugins and `<base>`, and report violations to
`/api/csp-report` (size-limited, rate-limited, stored for 30 days without link tokens). The browser tests
fail on any CSP violation.

`next.config.ts` also sends `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`,
`Cross-Origin-Resource-Policy: same-origin`, a `Permissions-Policy` that turns off camera, microphone,
location, payment, USB and topics, and HSTS in production. `X-Powered-By` is off; admin pages add
`X-Robots-Tag: noindex, nofollow` (so do the portal and the link pages).

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

The public site's content lives in the database and is edited in the admin (see Content editor below).
`content/` holds what a new database starts with: `site.ts` (contact details and the first profile),
`work.ts` (portfolio), `services.ts` (packages, prices, terms), `cv.ts` and `blog/*.md`. Name, email,
location and addresses stay in `content/site.ts`, as they are used by emails and invoices too.

The content follows fixed rules, checked on the seed by `tests/unit/content.test.ts` and on every publication
by the leak check:

- Only verifiable facts. Private projects are described from a facts sheet (purpose, capabilities,
  architecture, practices, stack) and never link to their code; public repositories do.
- No phone numbers, template leftovers, Discord ids, webhook URLs or keys anywhere in `content/`.
- No case studies, marketing copy or pricing for game-modification projects or cheat loaders.

Posts and case studies are Markdown, rendered when they are saved: remark and rehype, sanitised (scripts,
event handlers, `javascript:` links, iframes and every image not from the media library are removed), then
highlighted by Shiki in a light and a dark theme. The stored HTML is what pages show.

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

## Clients, projects, tasks and time

The admin's daily work (M5). Every change goes through `adminAction()`; stores in `server/clients`,
`server/projects`, `server/tasks` and `server/time` are the only code that queries these collections.

- **Clients** have a status (lead, active, past, archived), details, tags and private notes, and a log of
  calls, emails and meetings that happened outside the app. A client's page merges the log, their inbox
  messages and the emails sent to them, projects and revision rounds into one timeline. An inbox message
  becomes a client in one click (linking every other message from that address), and a new message from a
  known client's address is linked as it arrives. **Export** (a JSON file of everything about the client) and
  **delete** (the client with their projects, rounds, tasks, time and log, in one transaction) ask to confirm
  it's you and are written to the audit log; their inbox messages stay, unlinked, under the inbox's retention.
- **Projects** move through planned, in progress, in review and delivered on a board (paused and cancelled
  ones are in the list view). Each has a price (fixed, or hourly with an optional cap), an estimate,
  milestones, links, and a health view: time against the estimate, and the effective hourly rate of a fixed
  price or the value of billable hours. Edit forms carry a `version`, so saving over a newer change fails
  instead of undoing it.
- **Revision rounds** count against the project's included rounds ("2 of 3 used"). The counter and the round
  are written in one transaction, so two requests at once cannot both be round 2; a round past the included
  ones is marked billable with the extra-round price of that moment. Cancelling a round gives it back. A
  revision request in the inbox becomes a round, with a task on the project's board, in one click.
- **Tasks** live in lists (Today with anything late, Overdue, Upcoming by day, Anytime, Someday, Done) and on
  each project's board (to do, doing, done). Due dates are calendar dates in the owner's time zone. Finishing
  a repeating task moves it to its next date (after today, so a late one does not come back overdue).
- **Time**: one timer runs at a time, from the sidebar or any task or project. A unique partial index on the
  running entry makes that a database rule, not a UI habit: a second start at the same moment is refused by
  the index, stops the winner and tries again. Timers stopped within a minute are dropped. The timesheet shows
  the owner's week (Monday to Sunday, Istanbul time) with entries added by hand.
- **Boards** (`components/admin/work/board.tsx`) work with the keyboard (arrows move the focus, Shift and an
  arrow moves the card, Enter opens it) and a pointer. A move shows at once, is announced to screen readers,
  and is undone if the server refuses it. Each card stores a fractional rank (`lib/rank.ts`), so a move
  rewrites one document.
- **Money** is an integer amount of minor units with its currency (`lib/money.ts`); formatting, parsing and
  rounding happen only there.

## Calendar and booking

Calls with clients (M6): visitors book them at `/book`, the owner runs them from the admin's Calendar.
`lib/booking` holds the pure rules; `server/calendar` is the only code that touches the calendar's
collections.

- **Hours.** Weekly hours in the owner's time zone (Europe/Istanbul; up to four ranges a day), special dates
  with other hours or none, and the rules: a gap after each meeting, the notice needed, how far ahead, start
  times every 15, 30 or 60 minutes, and a daily limit. The defaults fit a school week: weekday evenings, a
  longer Saturday, Sundays off. Blocks (school, an exam, focus time, away) keep any stretch of time free,
  with the gap after them like a meeting's.
  The hours are saved with a `version`, so a second tab cannot silently undo a change.
- **The slot engine** (`lib/booking/slots.ts`) works in the owner's wall clock and turns each open range
  into instants per day, so a day that changes its clocks still offers the right hours. Every time starts on
  a 15-minute cell. The visitor sees the times in their own zone, found in the browser and changeable.
- **No double booking, by construction.** A meeting holds the 15-minute cells from its start to its end plus
  the gap, as documents in `slot_locks` whose `_id` is the cell. They are inserted in the same transaction as
  the meeting, so a second booking of any of those cells fails on the unique key, however close together the
  two requests arrive. The daily limit is a counter per day in `booking_days`, raised by a conditional upsert
  in the same transaction. Moving a meeting swaps its cells in one transaction; declining or cancelling
  frees them. The integration tests race six bookings for one time (one wins) and five for a limit of two.
- **Booking types** (an intro call, a project check-in) have their own link, a length, public or secret
  (the link carries a random key, which the owner can replace; the address alone finds nothing), an optional
  approval step (the time is held until the owner answers, and its invite is tentative), where the call happens
  (a Jitsi Meet room made per meeting with an unguessable name, Discord, or anything else) and up to five
  questions. A meeting keeps its own copy of the title and length, so changing or deleting a type does not
  change booked calls.
- **The guest's link.** Each booking has a 256-bit secret. The meeting stores only its SHA-256, for lookups,
  and a copy sealed with AES-256-GCM (the data key, bound to the meeting's id), so later emails can carry the
  link. The emails themselves stay in the outbox's delivery log for 30 days, which backups leave out, and the
  answer kept for a repeated booking request holds the meeting's id, not the link. The link's page lets the
  guest reschedule to an open time or cancel until the call starts; it is noindex, sends no referrer, and runs
  under the nonce CSP.
- **Emails with calendar invites.** Confirmations, changes and cancellations carry an iCalendar invite
  (RFC 5545: escaped and folded lines, a stable UID, `SEQUENCE` raised on every change, `METHOD:CANCEL` on a
  cancellation, also when a request is declined), so the guest's calendar updates the same event. One reminder
  goes out within the day before the call (not in its last hour), unless the call was booked or moved in the
  last 12 hours or the owner set it up without emailing the guest. The owner is told by email or Discord.
  Everything goes through the outbox with a `dedupeKey`.
- **The admin.** A week grid (an agenda on phones) with meetings, requests, blocks and deadlines, the owner's
  open hours shaded; the requests waiting for an answer; a page per meeting (confirm, decline with a note,
  move, cancel, a private note, the client it belongs to); meetings set up by the owner, which may fall
  outside the bookable hours but never overlap another; the hours editor and the booking types. The sidebar
  counts the requests waiting, Today lists the next calls with their join links, and a client's timeline
  shows their calls.
- **The feed.** A private iCalendar feed of meetings, blocks, and task, project and milestone deadlines,
  for Google Calendar, Apple Calendar or Outlook. Its address holds a secret (only its hash is stored); it
  is shown once, and can be replaced or turned off (both ask to confirm it's you).
- **Abuse and retention.** Bookings are rate-limited per address before anything is looked up (5 per 10
  minutes; the guest's link 20; open times 60 a minute), and use Turnstile, a hidden field for bots and an
  idempotency key. Meetings are deleted
  24 months after they end (a TTL index); cell locks and day counters expire a day after the meeting.

## Quotes, invoices and payments

Money from a client (M7): a quote they accept from its link becomes a project and its first invoice; an
invoice is paid by bank transfer or in crypto through NOWPayments. `lib/billing` holds the pure rules;
`server/billing` is the only code that touches the billing collections.

- **Amounts.** Integer minor units with their currency everywhere, and all arithmetic in `lib/money.ts` and
  `lib/billing/document.ts`: quantities in thousandths, percentages in basis points, products and
  percentages through `scaleMinor()` (BigInt, rounded half away from zero), a payment schedule whose
  payments are worked out as their invoices will be (each share before tax, with the taxes on it; the last
  takes the remainder), so the quote shows exactly what the deposit invoice asks and the steps add up. The same functions preview totals in
  the editor and compute them on the server. The database refuses a malformed document too: quotes,
  invoices, payments, expenses and recurring invoices have `$jsonSchema` validators.
- **Quotes.** Written from a client (an inbox message on the way), with lines (or picked from the services
  catalogue, prices copied), a discount, taxes, a payment schedule (all upfront, 50/50 or 40/30/30), a
  timeline and revision rounds. A quote is numbered (`Q-2026-0001`) when first sent and valid for 14 days by
  default. Its link (`/q/<publicId>`, 128 random bits) shows it and takes the answer; accepting is one
  transaction that checks the quote's version, marks it accepted, creates the project with a milestone per
  payment and issues the first invoice. A changed quote can't be accepted from an old page.
- **Invoices** are drafts until issued. Issuing numbers them (`INV-2026-0001`, credit notes `CN-`) from a
  counter in the same transaction, and freezes the seller's details, the document's label ("Payment request"
  until the owner issues e-Arşiv invoices), the ways to pay and the bank account. An issued invoice never
  changes: it is voided (only while nothing is paid or credited on it; asks to confirm it's you) or corrected
  by a credit note, which takes its amount off what the invoice owes in the transaction that issues it (in
  the invoice's currency, never beyond its total). An invoice covered by payments and credit notes is
  settled; a credit note is never voided. Its link (`/i/<publicId>`) shows the amount left and only the ways to pay it offers; quotes and
  invoices are also PDFs (`@react-pdf/renderer`, Geist, amounts with currency codes because the font has
  no ₺). Opening a link is recorded as "viewed".
- **Payments.** A payment and the invoice's paid amount change in one transaction, and the invoice is paid
  once they cover it; an amount beyond what's left is refused. A bank transfer is recorded by hand (asks to
  confirm it's you, audited, and the client gets a receipt); a refund takes it off the invoice again.
- **Crypto (NOWPayments).** The client's click opens one checkout per invoice (a unique partial index makes
  two clicks one), for the amount left, on NOWPayments' hosted page, reused while it's current. Its
  callbacks (IPN) are size-limited and rate-limited, then checked: the HMAC-SHA512 signature over the
  key-sorted JSON (the three ways NOWPayments' own libraries sort it), compared in constant time; stored
  under a key per payment, status and time before anything else, so a repeat is recognised and one that
  failed half way is taken again; and then only the payment's status read back from NOWPayments' API counts,
  checked against our checkout's order, NOWPayments' invoice, amount and currency. Only `finished` credits
  the invoice. A part payment, a mismatch, money for an invoice that was paid or voided meanwhile, or more
  than what's left goes to the owner's review queue instead; a second payment through the same checkout gets
  a record of its own there. States only move forward, so late or repeated callbacks change nothing. A
  repeat that arrives while its first copy is being handled is answered 503, so NOWPayments sends it again;
  one whose handling stopped half way (a restart) is taken again after two minutes; and a job re-reads
  checkouts still pending from NOWPayments' API every 30 minutes, so a lost callback loses no payment.
  Amounts to and from NOWPayments are written and read as exact decimals.
- **Recurring invoices** (care plans, hosting) are issued every month, quarter or year on the plan's day of
  the month (the 31st falls back to a shorter month's last day), between 09:00 and 21:00, and emailed.
  `{period}` in the title, lines or notes becomes the months covered. The plan's next date moves on in the
  transaction that issues the invoice, and the invoice records its plan and date under a unique index, so a
  date is never billed twice (a date already billed is refused when a plan is saved). A plan that can't be
  issued (no bank account for its currency) tells the owner once and tries again, without holding up the
  others. Editing a plan keeps it paused or running and keeps its day of the month; resuming a paused plan
  starts from its next date after today, so the paused months are not billed.
- **Reminders.** An unpaid invoice's client is reminded a day, a week and two weeks after the due date, at
  most one every five days, then no more; the owner can stop them per invoice. Each is claimed on the invoice
  first, so it goes out once.
- **A quote can only be sent if its first invoice could be paid** (a bank account in its currency, or crypto
  set up), and it keeps the seller's details as they were when sent.
- **The admin.** Billing's overview (owed, overdue, quotes out), lists, the editor, each document's page
  with its actions, payments and review queue, the NOWPayments callbacks log, and the settings (business
  details, payment terms, bank accounts with IBAN checks: changing them asks to confirm it's you, is audited
  and announced by email).

## Finance

- **Exchange rates** come from TCMB's daily bulletin (forex buying rates), stored per bulletin date as whole
  ten-thousandths of a lira. A day's amounts use the bulletin of the last business day before it (TCMB
  announces at 15:30 for the next day, as Turkish bookkeeping does), found within ten days, and only if
  every weekday in between is known to have had none: a bulletin missed while the server was off is fetched,
  not replaced by an older one. The job fetches
  `today.xml` each morning and after 15:30, and fills in older bulletins transactions need from TCMB's
  archive (a few per run; days without one are remembered). Conversions go through the lira with
  `scaleMinor()`, so they are exact; an amount without a rate is listed and left out of the totals in the
  base currency (`baseCurrency` in the billing settings, TRY by default), never guessed.
- **Expenses** have a date, amount and currency, a category, who was paid, what for, a receipt number and
  optionally a project.
- **The reports** (Finance → Overview): income (payments on the day they arrived, refunds on the day they
  were made), expenses and profit before tax, month by month (a chart drawn on the server, with a table of
  the same numbers), income by client, expenses by category, and what clients owe today by how late it is.
- **The accountant's CSV** has every payment, refund and expense in a span of days, with signed amounts,
  TCMB's rate and bulletin date, and the amount in the base currency; in the standard form or the one Excel
  opens as columns on a Turkish Windows. Text a spreadsheet would run as a formula is defused. Exporting asks
  to confirm it's you and is audited.

## Client portal

A client's own view of their work with the owner (M8), at `/portal`. `server/portal` holds its flows; every
page and endpoint reaches data through `requirePortalClient()` (`server/portal/dal.ts`) and the queries in
`server/portal/views.ts`, which all filter by the signed-in client's id.

- **Who gets in.** The owner turns the portal on for a client by inviting them from the client's page (or it
  is turned on when a client who never had it accepts a quote); turning it off signs the client out
  everywhere and spends their links. A client signs in with a link emailed to them: they type their address
  at `/portal/login` (Turnstile, a hidden field for bots, 5 requests per 15 minutes per connection and 3
  links an hour per address), and the answer is the same whether or not the address has a portal, so the
  form tells nobody who is a client: the links are made and queued after the answer has gone out, so it
  takes as long either way. An address shared by several clients gets one email with a link for each.
- **Links are spent by a person, not by opening them.** A sign-in link lasts 20 minutes, an invitation 7
  days; only the SHA-256 of its secret is stored. Opening the link shows a page with a button, and only the
  button's POST to `/api/portal/verify` uses it up (deleting it: whoever deletes it first gets in), so a mail
  scanner that follows every link in an email spends nothing.
- **Sessions of their own.** A portal session is a random token in its own cookie (`__Host-lf_portal`,
  HttpOnly, Secure, SameSite=Lax) and collection, so no portal cookie can ever pass an admin check or the
  other way round. It ends after 7 days unused or 30 days in all, and the client can sign out here or
  everywhere; the owner sees how many are active and can end them. Sessions and links are left out of
  backups.
- **What a client sees**: their projects (not cancelled ones) with the steps, the owner's updates, the links
  the owner marked as shared (only http(s) addresses become links) and the revision rounds; their issued
  invoices, credit notes and the quotes they were sent, each opening its own link's page to pay or answer;
  their calls, with the link to move or cancel each, and the booking types kept for clients (visibility
  "portal": not listed on `/book`, and booked through a link that carries the type's key); their details,
  and their data requests. Another client's project, by any address, answers 404.
- **Revision requests** count against the project's included rounds in the same transaction as the M5
  counter. A round past the included ones needs the client's agreement to its price: the form sends the
  price the client saw, and the transaction compares it with the price of that moment, so a page opened
  before the last included round was used, or before the price changed, cannot slip an extra one through:
  the server answers with the current price, and the form asks again. A paused project takes no requests.
  The owner is told by email and Discord, and the round is marked as coming from the portal.
- **Updates.** The owner posts a note on a project ("the staging site is up"), emailed to the client if
  asked (with the way to the portal only while theirs is on). Updates follow their project to another
  client, and are exported and deleted with it.
- **Data requests.** A client asks for a copy of their data or for its deletion (KVKK Article 11, GDPR
  Articles 15 and 17). One open request of each kind per client (a unique partial index); the owner is told
  and answers within 30 days. A copy is the client's export (M5), and the request is marked done or declined
  with a note for the record. A deletion is answered by deleting the client: the request goes with the rest
  of their data, and the audit log's entry for the deletion counts the requests it answered.
- **Endpoints** take small JSON bodies only from the site's own pages (the Origin and `Sec-Fetch-Site`
  check), are rate-limited per connection (signing out aside), and every email and alert goes through the
  outbox with a `dedupeKey`. The portal's pages are dynamic, noindex, under the nonce CSP, and `robots.txt` keeps crawlers
  out.

## Content editor

What the public site shows (M9), edited in the admin's Content section. `lib/content` holds the pure parts
(schemas, field lists, the leak check); `server/content` is the only code that touches the content
collections.

- **Drafts and published copies.** Every item (a case study, post, service or testimonial; the profile, the
  CV and the pricing terms) is one document in `content` with a `draft` the editor saves and a `published`
  copy the site shows. A save checks the draft with the same zod schema as the form, renders its Markdown and
  carries a `version`, so a save from an older tab is refused. Addresses (slugs) are unique per kind among
  drafts and published copies (the second by a unique index).
- **Publishing** checks the draft first (the leak check, and a testimonial's recorded permission), then, in
  one transaction, copies it over the published copy, keeps the replaced copy in `content_versions` and raises
  the content's generation. A version can be brought back into the draft; it is checked by today's rules and
  rendered again like any draft. A case study is cut into its numbered sections in the rendered tree, never
  in the HTML text. Taking an item off the site keeps
  its draft and a version; deleting it removes its versions too. The site's order follows the items' ranks.
- **Scheduled publishing.** A draft can be given a moment to go live; the `content-publish` job checks every
  minute, claims each due item first (so two processes never publish it twice) and runs the same checks. A
  draft that fails them is not published: the schedule is cleared and the owner told by email and Discord. An
  error on the way (the database) puts the schedule back, to be tried again.
- **The leak check** (`lib/content/leaks.ts`) looks at every published field of the draft as written and at
  the rendered HTML with its character references decoded (so `&#64;` hides nothing), never the private note
  about a testimonial's permission, for Discord webhooks and ids, database addresses with a password,
  private keys, API keys and tokens, secrets from settings files, IP addresses (except loopback and
  documentation ranges), email addresses other than the owner's, phone numbers, and the owner's own list of
  words (Content → Leak check). Anything found stops the publication and is listed, shortened so no secret is
  shown in full. There is no override: the text is changed instead. A repository is checked before it is
  shown on the work page, and Content → Leak check (or `npm run content:lint`) checks everything already
  published against today's list of words.
- **Rendering per request.** Public pages, feeds, the sitemap, link preview images and the CV PDF render per
  request from a snapshot of the published content that each server process keeps in memory
  (`server/content/site.ts`). It asks the database at most every three seconds whether the generation
  changed and reloads when it did; if the database is unreachable it keeps showing the last copy and asks
  again after 30 seconds. The process that made a change drops its copy at once. A new database is filled from `content/` once, by
  `npm run migrate` (or the first request), safely from several processes at the same moment.
- **Preview.** The editor's Preview button posts to `/admin/preview` (behind the sign-in and Access), which
  hands out a key for an hour (only its SHA-256 is kept) in a cookie and opens the public page: while the key
  is valid and the admin session that asked for it is still signed in, public pages show the drafts, under a
  banner with Exit preview. Link previews, feeds and the sitemap never show drafts.
- **Media library.** Images are uploaded in the admin (12 MB at most), recognised by their first bytes (PNG,
  JPEG, GIF, WebP, AVIF; never by name), decoded by sharp, turned upright, scaled to 2400 pixels and written
  again as WebP, which leaves all metadata behind. They are stored in the database under the SHA-256 of their
  bytes, so backups include them and the same image is kept once, and served from `/media/<sha256>.webp`
  with a year's caching. An image still shown by a draft, a published page or a kept version can't be
  deleted.
- **GitHub.** Every six hours (or on Sync now) the `github-sync` job reads the owner's public repositories
  from GitHub's API, page after page, with an ETag so an unchanged list costs nothing; a `GITHUB_TOKEN` is
  optional. Nothing is removed unless every page was read. A repository
  appears on the work page only when the owner ticks it (and not when a case study already covers it); case
  studies show their repository's stars and last update. A repository made private or deleted leaves the
  list at the next sync.

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
- Every public page is checked with axe (WCAG 2.2 AA) in both themes, and for horizontal overflow at 360px;
  the admin's pages are checked with axe as the tests go through them.
- Admin tests that share data run in order: the sign-in tests, then the inbox and settings, then the work
  modules, then booking and the calendar, then billing, then the portal, then the content editor, which
  changes what public pages show (Playwright project dependencies in `playwright.config.ts`). The calendar tests book as visitors in London and New York, and check the invites
  the emails carry; the billing tests go from a quote to a crypto payment, a bank transfer and its refund, a
  care plan, an expense and the accountant's CSV; the portal tests go from the owner's invitation to the
  client's sign-in, revision rounds (one of them extra), a data request and the owner's answer.
- The integration tests' `mongod` closes idle files and checkpoints every second: every test file rebuilds
  its database before each test, and WiredTiger would otherwise hold thousands of files and abort at the
  open files limit.
- NOWPayments, TCMB and GitHub are played by a local mock in the end-to-end tests
  (`scripts/lib/e2e-mocks.ts`): it serves NOWPayments' API and payment page, sends signed callbacks when a
  test "pays", serves fixed bulletins and a list of repositories. The integration tests stub `fetch` instead.
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
| `@react-pdf/renderer`                                                                           | Generates `/cv.pdf` from the same data as the CV page, and the quotes' and invoices' PDFs.                            |
| `@axe-core/playwright`                                                                          | Accessibility checks (WCAG 2.2 AA) in the browser tests.                                                              |
| `nodemailer`                                                                                    | Sends email over SMTP (STARTTLS, TLS or plain), with correct encoding of non-ASCII names and subjects.                |
| `croner`                                                                                        | Runs the background jobs (outbox, backups, reminders, rates, recurring invoices) without overlapping runs.            |
| `sharp`                                                                                         | Re-encodes uploaded images (upright, scaled, WebP, metadata dropped); Next.js already depends on it.                  |

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
16. **Fractional ranks for ordered lists** instead of numbered positions: moving a card writes only that
    card, and a list renumbers itself only if two items were ranked at the same moment. The algorithm is
    small and public domain, so it lives in `lib/rank.ts` with its published test vectors instead of a
    dependency.
17. **Invariants live in the database.** "One timer runs" is a unique partial index and "round numbers are
    unique" a unique index with a transaction, so no race between two tabs can break them.
18. **Money as integer minor units with the currency** on every amount, and one module for its arithmetic,
    so no float ever reaches an invoice (M7) and amounts in different currencies are never added.
19. **Double booking is prevented by a unique key, not by a check.** Reading the open times and then
    inserting a meeting would let two bookings through at the same moment; one document per 15-minute cell,
    inserted in the meeting's transaction, makes the database refuse the second.
20. **Jitsi links and an iCalendar feed instead of the Google Calendar and Meet APIs.** They cost nothing,
    need no OAuth tokens kept on the server, and no Google account from the guest; the owner still sees
    everything in the calendar app of their choice.
21. **The guest's link is stored as a hash and a sealed copy.** The hash finds the meeting; the sealed copy
    lets reminders and change emails include the link, and a leaked meeting record or backup does not give
    away the link.

22. **A document is numbered when it is issued, and never changes after.** Numbers come from a counter in the
    issuing transaction, so there are no gaps from deleted drafts and no two documents share one; a mistake
    on an issued invoice is corrected by a credit note, as an accountant expects.
23. **A payment callback is a hint, not proof.** Only the status read back from NOWPayments' API with our
    key, matching the checkout's order, amount and currency, moves money; the signed callback only says
    when to look. Anything unusual waits for the owner instead of being guessed.
24. **Payment states only move forward**, enforced by conditional updates, so callbacks that arrive late,
    twice or out of order cannot undo a confirmation or credit an invoice twice.
25. **TCMB's rates, stored, instead of a live currency API.** They are free, official, and what the
    accountant uses; storing each bulletin makes every report and CSV reproducible, and a missing rate is
    shown as missing.
26. **Reminders and recurring invoices are claimed in the database before they are sent** (a conditional
    update, a unique period per plan), like every other message, so a restart or a second process never
    sends one twice.
27. **Emailed sign-in links instead of client passwords.** Clients visit a few times a month; a link needs
    no password to forget, reuse or leak, and the owner's mailbox provider is already trusted with their
    invoices. Links are spent only by a button's POST, because mail scanners open links.
28. **The portal has its own sessions and cookie**, not a role on the admin's. The admin's checks never
    look at a portal session, so a mistake in the portal can't open the admin, and each can be changed
    (lifetimes, sign-out everywhere) without touching the other.
29. **Another client's data answers 404, never 403**, and the only way to it is a query that filters by
    the signed-in client's id; the pages never receive an id they then have to check.
30. **Public pages render per request from an in-memory snapshot, not at build time** (M9). Builds see no
    database (CI has none, and the deploy builds before the migrations and without the production settings),
    so prerendering from the database would bake stale or starting content into each release. The snapshot
    makes a page cost no query, an edit shows within seconds without tracking which pages to rebuild, and
    every page can carry a CSP nonce.
31. **One `content` collection with a draft and a published copy per item**, instead of a collection per
    kind: one set of rules for saving, publishing, scheduling, versions and the leak check, and the site's
    whole content is one query.
32. **Images in the database, not on disk.** A few hundred re-encoded images fit easily, backups and
    restores include them with no second folder to copy, and their hash is their address.
33. **The leak check has no override.** A publication it stops is edited, not forced; the owner's own list
    of words covers what no pattern can know (client names, private domains).
