# Deploying leffloard.xyz

How the site runs on the Windows server, how to set it up once, how to switch over from v1, and what to do
every day after that. The scripts live in [`deploy/windows`](../deploy/windows); run them from a PowerShell
window opened with **Run as administrator**.

```text
visitor ──https──> Cloudflare (DNS, TLS, Access on /admin, Turnstile)
                        │  outbound-only tunnel, no open ports on the server
                        ▼
Windows server:  cloudflared service ──> 127.0.0.1:3000  "leffloard" service (Node.js, NT SERVICE\leffloard)
                                                       └──> MongoDB Atlas
```

| Folder                                    | What is in it                                                  |
| ----------------------------------------- | -------------------------------------------------------------- |
| `C:\leffloard\app`                        | The Git checkout. Deploys build here.                          |
| `C:\leffloard\releases\<yyyyMMdd-HHmmss>` | One self-contained folder per deploy (the newest 5 are kept).  |
| `C:\leffloard\current`                    | A junction to the running release. Switching it is the deploy. |
| `C:\leffloard\shared\leffloard.env`       | The settings. Readable only by the service and administrators. |
| `C:\leffloard\shared\backups`             | Encrypted nightly backups (the newest 14 are kept).            |
| `C:\leffloard\shared\logs`                | `service.log` (rotated at 10 MB) and the deploy trials' logs.  |

## 1. Prepare the server (once)

1. Update Windows. In Windows Defender Firewall, allow Remote Desktop only from your own IP address (the
   rule's Scope tab); the site itself needs no inbound port.
2. Install [Node.js 24 LTS](https://nodejs.org) (the Windows installer, which includes npm) and
   [Git for Windows](https://git-scm.com).
3. Download [NSSM 2.24](https://nssm.cc/download) and copy `win64\nssm.exe` to `C:\leffloard\tools\nssm.exe`.
4. Get the code: `git clone https://github.com/leffloard/leffloard.xyz C:\leffloard\app`
5. MongoDB Atlas: under **Network Access**, add the server's public IP address. Under **Database Access**,
   use a user with **readWrite** on the `leffloard` database only.
6. Create the service:
   `powershell -ExecutionPolicy Bypass -File C:\leffloard\app\deploy\windows\install-service.ps1`

## 2. Settings

`install-service.ps1` created `C:\leffloard\shared\leffloard.env` from
[`leffloard.env.example`](../deploy/windows/leffloard.env.example). Fill it in with Notepad (as
administrator). Every variable is explained in [`.env.example`](../.env.example).

| Setting                                            | Where it comes from                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `MONGO_URL`                                        | Atlas → Connect → Drivers. Paste only the address.                                   |
| `HEALTH_TOKEN`                                     | `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`     |
| `DATA_ENCRYPTION_KEYS`                             | `node -e "console.log('1:' + require('crypto').randomBytes(32).toString('base64'))"` |
| `BACKUP_KEY`                                       | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`        |
| `TURNSTILE_*`, `CF_ACCESS_*`                       | Section 3 below.                                                                     |
| `SMTP_*`, `NOTIFY_EMAIL_TO`, `DISCORD_WEBHOOK_URL` | The same values as the v1 `.env`. Gmail needs an App Password.                       |

Put `DATA_ENCRYPTION_KEYS` and `BACKUP_KEY` in your password manager as well. Without the first, two-step
sign-in secrets cannot be read (`admin reset-2fa` recovers); without the second, no backup can be restored.

The app checks the settings when it starts. A mistake stops it with a plain-English list in
`C:\leffloard\shared\logs\service.log`; nothing is ever printed with its value.

## 3. Cloudflare

**Tunnel.** Zero Trust → Networks → Tunnels → **Create a tunnel** (Cloudflared) → name it (for example
`leffloard-vds`) → choose Windows and run the `cloudflared.exe service install <token>` command it shows,
as administrator. Then add a **public hostname**: `leffloard.xyz` → type `HTTP`, URL `localhost:3000`. Add
`www.leffloard.xyz` the same way, or redirect it to the apex with a redirect rule.

**Access for the admin.** Zero Trust → Access → Applications → **Add an application** → Self-hosted: domain
`leffloard.xyz`, path `admin*`. Policy: Allow, include your email address; login method One-time PIN.
Copy the **Application Audience (AUD) Tag** into `CF_ACCESS_AUD` and your team domain
(`<team>.cloudflareaccess.com`) into `CF_ACCESS_TEAM_DOMAIN`. With both set, the app also refuses admin
requests that did not come through Access.

**Turnstile.** Turnstile → Add widget → hostname `leffloard.xyz`, mode Managed. Copy the site key and the
secret key into `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`.

**Leave these off**, because they rewrite pages and break the Content Security Policy: Rocket Loader, Email
Address Obfuscation, and Automatic Platform Optimization. Keep SSL/TLS on Full and Always Use HTTPS on.

## 4. First deploy

1. `powershell -ExecutionPolicy Bypass -File C:\leffloard\app\deploy\windows\deploy.ps1`
   It builds, backs up, migrates, starts the new release on port 3101 for a trial, and only then switches
   `current` and starts the service.
2. Create your account: `C:\leffloard\app\deploy\windows\app.ps1 admin create`
3. Open https://leffloard.xyz/admin. Access asks for the one-time PIN, then the site's own sign-in sets up
   the authenticator app. Save the recovery codes, then add a passkey on the Security page.
4. In **Settings**: send a test email and a test Discord message, and press **Back up now** once.

## 5. Switching over from v1 (once)

1. Make a final backup: `app.ps1 backup`.
2. Copy the v1 requests into the inbox: `app.ps1 migrate-legacy` (a dry run that only counts), then
   `app.ps1 migrate-legacy --apply`, then `app.ps1 migrate-legacy --verify`. The v1 data is only read.
3. Point `leffloard.xyz` at the tunnel: if the domain's DNS still points at the v1 server, delete those A or
   CNAME records; the tunnel's public hostname creates its own CNAME.
4. `deploy\windows\smoke.ps1` checks the main pages and security headers from outside.
5. Watch for two days: the Settings page (delivery log, backups, jobs) and `service.log`.
6. Going back within 14 days means pointing the hostname at v1 again; v1's `requests` collection was never
   changed. Messages that arrived in the meantime stay in the new inbox.
7. After 14 days, the v1 code (`frontend/`, `backend/`) is deleted (milestone M12).

## 6. Every day

| Task                     | Command (in `C:\leffloard\app\deploy\windows`)                     |
| ------------------------ | ------------------------------------------------------------------ |
| Deploy the latest `main` | `.\deploy.ps1`                                                     |
| Go back one release      | `.\rollback.ps1` (or `.\rollback.ps1 -To 20260926-120000`)         |
| Check the public site    | `.\smoke.ps1`                                                      |
| Owner account tools      | `.\app.ps1 admin status`, `reset-password`, `reset-2fa`, `unlock`  |
| Restart                  | `Restart-Service leffloard`                                        |
| Logs                     | `Get-Content C:\leffloard\shared\logs\service.log -Tail 100 -Wait` |

Migrations only add (fields, collections, indexes), so an older release keeps working on a newer database;
that is what makes `rollback.ps1` safe.

## 7. Backups and the restore drill

The app makes an encrypted backup every night from 03:15 (Istanbul time), or at the first check after that
if the server was off, and keeps the newest 14 in `C:\leffloard\shared\backups`. Atlas's free tier has no
backups of its own, so these are the only ones. Copy that folder somewhere else from time to time (a USB
drive or a cloud folder): the files are encrypted.

**Once a month, prove a backup restores:**

```powershell
.\app.ps1 restore C:\leffloard\shared\backups\<newest file>.lfbak --check
```

It checks the file, restores it into a temporary database, compares every collection with the backup's own
count, and deletes the temporary database. It should report "Every collection matches the backup's own
count".

**A real restore:** restore into a new database first, check it, then switch `DB_NAME` in the settings and
restart. That leaves the damaged database in place for comparison:

```powershell
.\app.ps1 restore <file> --into leffloard_restored
```

Replacing the live database in place is possible (`--into leffloard --replace`); it asks you to type the
database name first. Sessions are not in backups, so everyone signs in again afterwards.

## 8. A staging copy (optional)

A second, independent copy on the same server, for trying a branch before it goes live: its own folder,
service, port, database and hostname.

```powershell
.\install-service.ps1 -Root C:\leffloard-staging -ServiceName leffloard-staging -Port 3001
# settings: DB_NAME=leffloard_staging, SITE_URL=https://staging.leffloard.xyz,
#           BACKUP_DIR=C:\leffloard-staging\shared\backups
.\deploy.ps1 -Root C:\leffloard-staging -ServiceName leffloard-staging -Port 3001 -TrialPort 3102 -Branch <branch>
```

Give `staging.leffloard.xyz` its own tunnel hostname (`localhost:3001`) and an Access policy for the whole
hostname, so only you can see it.

## Troubleshooting

| Symptom                                | Look at                                                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare shows 502                   | `Get-Service leffloard, cloudflared`; then `service.log`.                                                                                |
| The service stops right after starting | The end of `service.log`: a settings problem is listed there in plain English.                                                           |
| The admin keeps asking for Access      | `CF_ACCESS_AUD` must be the tag of the application that covers `/admin`.                                                                 |
| Forms say the bot check failed         | `TURNSTILE_*` keys, and the widget's hostname list.                                                                                      |
| Backups fail with "access denied"      | Run `install-service.ps1` again (it grants the service write access to `backups`), then `Start-Service leffloard`: it stops the service. |
| A deploy stopped at the trial          | `C:\leffloard\shared\logs\trial-<time>.log`; the live site was not changed.                                                              |
