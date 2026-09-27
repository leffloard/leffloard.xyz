# Runbook

What to do when something goes wrong, how to change each secret, and the routine that keeps problems away.
Setting up the server, deploys, rollbacks and restoring a backup are in [DEPLOY.md](DEPLOY.md); the commands
below run in `C:\leffloard\app\deploy\windows` from a PowerShell window opened as administrator.

## First look

Whatever the problem, these four answer most of it:

1. **Is it up?** `.\smoke.ps1` checks the main pages and security headers from outside.
2. **Is it healthy?** `https://leffloard.xyz/api/health?deep=1` with the header `x-health-token: <HEALTH_TOKEN>`
   reports the settings, the database and the migrations.
3. **What does it say?** The admin's **System** page: database, background jobs, backups, the error log and
   CSP reports. Without the admin: `Get-Content C:\leffloard\shared\logs\service.log -Tail 200`.
4. **What changed?** The last deploy (`C:\leffloard\current` points at its release folder) and the audit log
   (Security page).

If the last deploy is the likely cause, go back first and investigate after: `.\rollback.ps1`.

## Incidents

### The site is down or shows Cloudflare's 502

1. `Get-Service leffloard, cloudflared`. Start whichever stopped: `Start-Service leffloard`.
2. If `leffloard` stops again at once, the end of `service.log` names the problem (usually a setting; its
   value is never printed). Fix `C:\leffloard\shared\leffloard.env` and start it again.
3. If it runs but pages fail, check the health address above. "database" failing: Atlas status page, the
   cluster's **Network Access** list (the server's IP address), and the database user's password.
4. Still down after a deploy: `.\rollback.ps1`.

### A deploy went wrong

`deploy.ps1` switches only after the new release answered healthily on a trial port, and rolls back by
itself if it is unhealthy after the switch. If a problem shows up later: `.\rollback.ps1` (the previous
release) or `.\rollback.ps1 -To <yyyyMMdd-HHmmss>`. Migrations only ever add, so an older release runs on the
newer database.

### Data was deleted or damaged

1. Stop the damage first: `Stop-Service leffloard` if it is still happening.
2. Restore the newest good backup into a **new** database and check it:
   `.\app.ps1 restore C:\leffloard\shared\backups\<file>.lfbak --into leffloard_restored`
3. Point `DB_NAME` at `leffloard_restored`, start the service, check the admin.
4. Keep the damaged database until you are sure; anything created after the backup is only there.

Sessions are not in backups, so you sign in again afterwards.

### Someone may have got into the admin

Signs: a sign-in in the Security page's **Recent activity** or **Signed-in devices** that wasn't you, audit
log entries you didn't make, or an alert that sign-in was locked after failed attempts. "Your password was
right, the codes were wrong" means someone knows your password: start with step 1 at once.

1. Security page: **Sign out everywhere else**, then **Change password** (it signs out every other device
   too).
2. **Move to a new phone** (a new authenticator secret) and **Create new codes** (new recovery codes).
   Remove any passkey you don't recognise.
3. If you can't sign in: on the server, `.\app.ps1 admin reset-password`, then `.\app.ps1 admin reset-2fa`.
4. Cloudflare Zero Trust → Logs → Access: who passed the Access check for `/admin`.
5. Read the audit log from the first strange entry: what was changed, sent or exported. Invoices and quotes
   keep their history; the content editor keeps versions.
6. If the server itself may be compromised (not just the account): rotate every secret below, starting with
   `MONGO_URL`'s password, `DATA_ENCRYPTION_KEYS` and `BACKUP_KEY`.

### A secret leaked

Change it at its source, put the new value in `leffloard.env`, and restart (`Restart-Service leffloard`).
[Changing secrets](#changing-secrets) lists each one and what else to do.

### A flood of spam or bots

- Messages from one sender: open one, choose **Block this address** (or **Block the whole domain**) next to
  **Spam**, then press **Spam**. Their next messages go straight to spam, without alerts; Settings →
  **Blocked senders** lists them. (**Spam** alone moves the message and blocks no one.)
- Many senders: check that the bot check is on (System page → integrations, "Bot checks (Turnstile)"). Every
  form and the sign-in are also limited per address.
- An attack on the whole site: Cloudflare → Security → **Under Attack mode** for a while, or a rate-limiting
  rule for the busy path.

### Emails or Discord alerts stop arriving

1. Settings → **Delivery log**: failed messages show why. **Send a test email** and **Send a test to
   Discord** try each channel.
2. Gmail: an App Password stops working when the account's password changes or it's revoked. Make a new
   one ([Changing secrets](#changing-secrets)).
3. A failed message is tried six times in all, with growing pauses, over about 14 hours; after that it
   stays failed. Once the channel works again, press **Retry failed** under **Delivery log**. Alerts held
   back by quiet hours go out when the quiet time ends.

### Payments look wrong

- A crypto payment that doesn't match its invoice (part paid, too much, another currency) waits in Billing
  → **Payments** for your decision; nothing is credited by guesswork.
- A payment that is "finished" at NOWPayments but not here: a job asks NOWPayments about pending payments
  every 30 minutes, so a missed callback is caught up. Billing → Payments → **NOWPayments callbacks** shows
  the latest ones and whether each signature was right. Many rejected callbacks mean someone is sending
  forged ones; they are refused, and at most 500 a day are logged.
- If NOWPayments' IPN secret or API key changed, update both in the settings (below).

### AI costs run away

Admin → **AI**: untick **The AI assistant is on**. Nothing is sent to Anthropic while it is off. The monthly
budget stops requests before they would pass it; lower it on the same page. The key can also be revoked at
console.anthropic.com.

### Backups fail

The System page shows the last backup and its error, and a failed nightly backup is an alert. Usual causes:
a full disk, no `BACKUP_KEY`, or a `BACKUP_DIR` the service can't write to. `install-service.ps1` grants the
service write access to `C:\leffloard\shared\backups`; it also stops the service, so start it again after
it (`Start-Service leffloard`). For another folder, grant it yourself:
`icacls "<folder>" /grant "NT SERVICE\leffloard:(OI)(CI)M"`. Then press **Back up now**.

## Changing secrets

Every secret lives in `C:\leffloard\shared\leffloard.env` (and, for the ones marked \*, in your password
manager). After editing: `Restart-Service leffloard`.

| Secret                          | Where to make a new one                                                                     | Also                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Admin password                  | Security page → **Change password**                                                         | Signs out every other device.                                                                  |
| Authenticator app               | Security page → **Move to a new phone**                                                     | The old app's codes stop working once the new one is confirmed.                                |
| Recovery codes                  | Security page → **Create new codes**                                                        | The old codes stop working.                                                                    |
| `MONGO_URL` (database password) | Atlas → Database Access → the user → Edit → new password                                    | Update `MONGO_URL` right after; the site can't reach the database in between.                  |
| `DATA_ENCRYPTION_KEYS` \*       | `node -e "console.log('2:' + require('crypto').randomBytes(32).toString('base64'))"`        | See below.                                                                                     |
| `BACKUP_KEY` \*                 | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`               | See below.                                                                                     |
| `HEALTH_TOKEN`                  | `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`            | Update anything that calls the deep health check.                                              |
| `SMTP_PASSWORD` (Gmail)         | Google Account → Security → App passwords: remove the old one, create a new one             |                                                                                                |
| `DISCORD_WEBHOOK_URL`           | Discord → the channel's settings → Integrations → Webhooks: delete it, make another         |                                                                                                |
| `TURNSTILE_SECRET_KEY`          | Cloudflare → Turnstile → the widget → Rotate secret key                                     | The site key stays the same.                                                                   |
| `NOWPAYMENTS_API_KEY`           | NOWPayments → Store Settings → API keys                                                     |                                                                                                |
| `NOWPAYMENTS_IPN_SECRET`        | NOWPayments → Store Settings → Instant payment notifications                                | Callbacks signed with the old secret are refused; the payment check catches those payments up. |
| `ANTHROPIC_API_KEY`             | console.anthropic.com → API keys: create one, delete the old one                            | Set a spend limit on the new key there too.                                                    |
| `GITHUB_TOKEN` (optional)       | GitHub → Settings → Developer settings → fine-grained tokens, public repositories read-only |                                                                                                |
| Calendar feed address           | Calendar → Availability → **Calendar feed** → **Make a new address**                        | Subscribe again in your calendar app with the new address.                                     |
| A client's portal               | The client's page → **Sign out everywhere**, or **Turn off** to close it                    |                                                                                                |

**`DATA_ENCRYPTION_KEYS`** encrypts the authenticator secret, the recovery codes' check and each meeting's
reschedule link. Add the new numbered key and keep the old one listed: `2:<new>,1:<old>` (new secrets use the
highest number). Then on the Security page **Move to a new phone** and **Create new codes**, which store both
under the new key. Meetings booked earlier keep their links under the old key: remove `1:` once those
meetings are over. Removed sooner, the site can't rebuild those links (the pages leave them out; guests
still have them in their emails). If the key itself leaked, do the two Security page steps at once.

Backups made before the change hold the authenticator secret and recovery codes under the old key: keep
every retired key in the password manager for as long as such backups are kept, and list it again
(`2:<new>,1:<old>`) before restoring one. Otherwise sign-in needs `.\app.ps1 admin reset-2fa` after the
restore.

**`BACKUP_KEY`**: new backups use the new key; keep the old one in the password manager for the older files
(each file names its key's fingerprint). To restore an older file, give the old key to that one command:

```powershell
$env:BACKUP_KEY = "<old key>"; .\app.ps1 restore <file> --check; Remove-Item Env:BACKUP_KEY
```

`CF_ACCESS_AUD`, `CF_ACCESS_TEAM_DOMAIN` and `TURNSTILE_SITE_KEY` are not secrets. `ADMIN_JWT_SECRET` and
the other v1 settings are not used by this version; revoke them with v1 (below).

## The first two weeks after the switch

The switch itself is [DEPLOY.md, section 5](DEPLOY.md#5-switching-over-from-v1-once). For 14 days after it:

- Every day: the Today page's alerts, the System page (jobs green, a backup from last night) and the inbox.
  `service.log` for anything at error level.
- Going back is pointing the tunnel's hostname (or the DNS records) at v1 again. v1's `requests` collection
  was never changed; messages that arrived in the meantime stay in the new inbox, so reply from there.
- Keep v1 running and untouched until the 14 days are over.

## Removing v1 (after 14 days)

Once nothing points at v1 any more, in one pull request:

1. Delete `frontend/`, `backend/`, `tests/test_requests_api.py`, `tests/conftest.py`, `tests/__init__.py`,
   `pytest.ini` and `egefitnessalwaysinbussinies.bat`.
2. Remove the `legacy` job from `.github/workflows/ci.yml`, and the v1 entries from `.prettierignore`,
   `eslint.config.mjs` (`globalIgnores`) and `tsconfig.json` (`exclude`).
3. README: remove the "v1 (current live site)" half and the note at the top that points to it.
4. `tests/legacy-parity.md`: note that the Python tests were removed and live on under the `v1-legacy` tag.
5. `npm run verify` (and CI, if it runs), then merge.

Outside the repository:

- Shut down v1's server or hosting and delete its settings file; the secrets in it (`ADMIN_JWT_SECRET`, the
  Discord webhook, the Atlas password it used) should already be rotated, as they were shared once.
- In Atlas, delete v1's database user if it had its own.
- The `requests` collection can stay (it is small, and `migrate-legacy --verify` reads it). To drop it, make a
  backup first.

## Without GitHub Actions

GitHub Actions doesn't run jobs for this account for now, so the **CI** and **Nightly** workflows are disabled
(Actions tab → the workflow → ⋯ → **Disable workflow**) instead of failing on every push and every night.
The site doesn't need them: `deploy.ps1` builds, migrates, checks and rolls back on the server by itself.
What they checked is checked by hand instead, in a copy of the repository (not on the server).

**Before anything is merged into `main`**, on the branch to be merged (a pull request, Dependabot's too:
`git fetch origin pull/<number>/head`, then `git checkout FETCH_HEAD`):

```powershell
npm ci
npm run verify
```

`verify` runs CI's checks job in its order and stops at the first failure: formatting, lint, types, the unit,
integration and security tests, the build, the browser tests and the audit of production dependencies. The
first time on a machine, run `npx playwright install chromium` before it. Also:

- When `deploy/` changed, the deploy scripts' tests, in the Windows PowerShell 5.1 the server has (CI's
  Windows job ran them): `powershell -NoProfile -ExecutionPolicy Bypass -File deploy\windows\tests\common.tests.ps1`.
- When `backend/` changed (until v1 is removed): `pip install -r backend/requirements-dev.txt`, then
  `python -m pytest -q`.

**Once a month**, what the nightly workflow checked, after `npm ci` and `npm run build`:

```powershell
npm run test:security
npm audit --audit-level=moderate
npx --yes @lhci/cli@0.15.1 autorun
npx --yes @lhci/cli@0.15.1 autorun --collect.settings.preset=desktop
npx playwright install firefox webkit
$env:PW_ALL_BROWSERS = "1"; npx playwright test --project firefox --project webkit --project pixel --project iphone --no-deps; Remove-Item Env:PW_ALL_BROWSERS
gitleaks git --redact
```

The last line scans the whole history for secrets and should find none (`.gitleaksignore` lists the tests'
fake values); gitleaks is a single program (its Windows build is on
[its releases page](https://github.com/gitleaks/gitleaks/releases)). CodeQL has no stand-in; the security
suite and lint cover the main risks.

When Actions runs jobs again, enable both workflows on the Actions tab.

## Routine

**Every week**

- Dependabot's pull requests (Monday): merge each once CI is green or, while Actions is off, once `npm ci`
  and `npm run verify` pass on it. Security fixes for Next.js go out at once: `.\deploy.ps1`.
- Glance at the nightly workflow on GitHub (Actions → Nightly): every browser, Lighthouse, the security
  suite, the dependency audit, the secret scan and CodeQL. While Actions is off, run its checks by hand once
  a month instead ("Without GitHub Actions").

**Every month**

- The restore drill: `.\app.ps1 restore C:\leffloard\shared\backups\<newest>.lfbak --check`, which should
  report "Every collection matches the backup's own count" (and then delete its temporary database). Copy
  the backups folder somewhere off the server.
- Security page: signed-in devices and recent activity. Anything unfamiliar → the incident steps above.
- System page: database size against Atlas's 512 MB, the error log, CSP reports (a new source in them
  usually means a browser extension; a new one from the site itself is a bug).
- AI page: the month's spend against the budget; **Add to expenses** records it in Finance.
- Windows Update on the server, and a Node.js 24 update if one is out (install it, then `.\deploy.ps1`).

**Every year**

- Rotate `HEALTH_TOKEN`, the Gmail App Password and the Discord webhook, and consider a new
  `DATA_ENCRYPTION_KEYS` number (steps above). Check that the password manager has `DATA_ENCRYPTION_KEYS`
  and every `BACKUP_KEY` still needed.
- Renew anything with an end date: the domain (Cloudflare), the NOWPayments account's details, API keys
  with expiry dates.
