# Load tests

Four [k6](https://grafana.com/docs/k6/latest/) scripts that check the site under load. Each ends with a
pass or fail per threshold.

| Script            | What it does                                                                 | Passes when                                                                       |
| ----------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `booking-race.js` | 100 visitors book the same three times at the same moment                    | exactly 3 bookings; everyone else gets "that time is gone"                        |
| `slots.js`        | 20 requests a second for a booking type's open times, for a minute           | 95% answered within 300 ms, under 1% errors                                       |
| `pages.js`        | Up to 50 visitors reading the public pages, a page every 1–3 seconds         | 95% of pages within 800 ms, each with its nonce CSP; under 1% errors              |
| `ipn-flood.js`    | 50 forged NOWPayments callbacks a second for 30 seconds, from five addresses | every one refused (401, or 429 once an address sends too many), 95% within 200 ms |

Whether a real payment is applied exactly once, however often and in whatever order its callbacks arrive,
is tested without k6: `tests/integration/payments.test.ts` sends a shuffled flood of 500 signed callbacks for
five payments. What a page downloads (JavaScript, CSS, fonts) is checked by `tests/e2e/budgets.spec.ts` in the
end-to-end tests.

## Never against the live site

The scripts book meetings, send emails and fill the webhook log. Run them against a copy with its own
database: on your PC (simplest), or a staging copy on the VDS. Never against leffloard.xyz itself or its Atlas
database (Atlas M0 is limited to 100 operations a second, and the bookings and emails would be real).

## On your PC

1. Install k6 (version 1.x): `winget install k6 --source winget`, or download it from
   [github.com/grafana/k6/releases](https://github.com/grafana/k6/releases).
2. Build the site and start it with a throwaway database, exactly as the end-to-end tests do (port 3100,
   emails written to the log, no bot check):

   ```powershell
   npm run build
   npm run e2e:server
   ```

3. In a second terminal, from the repository:

   ```powershell
   k6 run load/booking-race.js
   k6 run load/slots.js
   k6 run load/pages.js
   k6 run load/ipn-flood.js
   ```

   Stop the server with Ctrl+C afterwards; its database is thrown away. Start it again before running
   `booking-race.js` a second time (the three times it books are gone).

## On a staging copy

A second copy of the site on the VDS, with its own database and port, not reachable from the internet:

- `DB_NAME` (and `MONGO_URL` if needed) of a database that holds nothing real. A local MongoDB on the VDS is
  best; not the production Atlas cluster.
- `EMAIL_DELIVERY=log`, no `DISCORD_WEBHOOK_URL`, and no Turnstile keys (or Cloudflare's test keys), so
  nothing reaches real people and the bot check doesn't stop k6.
- `CLIENT_IP_SOURCE=socket`, and k6 running on the VDS itself against `http://127.0.0.1:<port>`. Each virtual
  visitor then counts as its own address (the scripts send an `X-Forwarded-For` per visitor), so the
  per-address limits don't stop the test. Through the Cloudflare Tunnel all of k6 would be one address, and
  Cloudflare's own protection would get in the way.
- The public booking type the scripts book (`intro-call` by default, which every new database starts with)
  must confirm without approval and have open times on at least three days.

Then run the scripts with `-e BASE_URL=http://127.0.0.1:<port>`.

## Options

Each script reads a few settings with `-e NAME=value`:

| Setting    | Scripts                       | Default                                                     |
| ---------- | ----------------------------- | ----------------------------------------------------------- |
| `BASE_URL` | all                           | `http://127.0.0.1:3100`                                     |
| `TYPE`     | `booking-race.js`, `slots.js` | `intro-call`                                                |
| `VISITORS` | `booking-race.js`             | `100`                                                       |
| `ANSWERS`  | `booking-race.js`             | an answer to `intro-call`'s question: `{"q-intro-1":"..."}` |
| `RATE`     | `slots.js`, `ipn-flood.js`    | `20` and `50` requests a second                             |
| `DURATION` | `slots.js`, `ipn-flood.js`    | `1m` and `30s`                                              |
| `VUS`      | `pages.js`                    | `50` visitors at the peak                                   |
| `RAMP`     | `pages.js`                    | `30s` to reach the peak                                     |
| `HOLD`     | `pages.js`                    | `1m` at the peak                                            |

A booking type with other required questions needs their answers: `-e ANSWERS='{"<question id>":"..."}'`
(the ids are in the booking type's editor).

## Last results

27 September 2026, the production build on a development container (not the VDS), with the defaults:

| Script            | Result                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `booking-race.js` | 3 booked, 97 told the time is gone; all 100 answered within 5 s (p95 4.7 s)                 |
| `slots.js`        | p95 45 ms at 20 requests a second, no errors                                                |
| `pages.js`        | p95 26 ms, no errors                                                                        |
| `ipn-flood.js`    | 1,500 callbacks, all refused, p95 9 ms; 500 rejected callbacks logged for the day (the cap) |

The race is slow by design: 100 bookings of the same times in one moment wait for each other's
transactions. A real visitor books alone, in well under a second.
