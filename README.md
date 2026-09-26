# leffloard.xyz - Personal Portfolio and Blog

> **v2 is being built.** A new Next.js app at the repository root replaces `frontend/` and `backend/`,
> milestone by milestone. Until the cut-over, everything below the [v2 section](#v2-in-progress) still
> describes the live v1 site.

## v2 (in progress)

One Next.js 16 app (TypeScript, Tailwind 4, MongoDB) for the public site, the client portal and the admin
system. Design, decisions and dependencies: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Run it locally

Requirements: Node.js 22.12 or newer (24 LTS recommended, see `.nvmrc`). Nothing else: the local database is
downloaded on the first start (about 100 MB).

1. In the repository root (not in `frontend/`): `npm install`
2. `npm run dev:db` starts a local MongoDB and creates `.env.local` for it. Keep this terminal open.
3. In a second terminal: `npm run dev`, then open http://localhost:3000.

Development never touches the production Atlas database. The local data lives in `.data/dev-db`; delete that
folder to start empty.

### Editing the public site

Until the admin's content editor arrives, the site's text lives in `content/`:

| File | What it holds |
| --- | --- |
| `content/site.ts` | Name, email, location, availability badge ("Taking new projects") |
| `content/work.ts` | Portfolio projects and their case studies |
| `content/services.ts` | Services, packages, prices, payment terms and FAQ |
| `content/cv.ts` | The CV (also used for `/cv.pdf`) |
| `content/blog/*.md` | Blog posts (Markdown with `title`, `description`, `date`, `tags` at the top) |

Your photo: save it as `public/images/profile.jpg` (portrait, about 1200 × 1500) and rebuild; until then the
About page shows your initials. `npm run test:unit` checks the content for broken links between projects,
phone numbers and other things that must not be published.

### The admin (`/admin`)

1. Create the owner account once, in a terminal on the machine that runs the site:
   `npm run admin -- create` (asks for email, name and a password of at least 12 characters).
2. Open `/admin/login` and sign in. The first sign-in sets up two-step sign-in: scan the QR code with an
   authenticator app (Google Authenticator, 1Password, Aegis…), enter its code, and save the 10 recovery codes
   it shows. They are not shown again.
3. On the Security page, add a passkey (Windows Hello, Touch ID or your phone) as a second way in.

Lost access? `npm run admin -- status` shows the account's setup; `reset-password`, `reset-2fa` and `unlock`
are the recovery paths (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#recovery)).

### The inbox

Messages from the contact form (`/contact`) land in **Inbox**: project briefs, questions, revision requests
and call requests. Open one to reply by email, change its status (and tell the visitor if you like), confirm
a call time, add labels or a private note, snooze it, mark it as spam or delete it. Keys in the list: `j`/`k`
to move, `Enter` to open, `/` to search.

Alerts about new messages go to Discord and to your email. Set them up in the server's environment (details
in [`.env.example`](.env.example); the names are the same as in the v1 `.env`):

1. **Email** (alerts and replies): for Gmail, create an App Password and set `SMTP_HOST=smtp.gmail.com`,
   `SMTP_USERNAME`, `SMTP_PASSWORD` and `NOTIFY_EMAIL_TO`.
2. **Discord** (alerts): a channel webhook in `DISCORD_WEBHOOK_URL`.
3. Restart, open **Settings** and use **Send a test email** and **Send a test to Discord**.

Locally, `npm run dev:db` sets `EMAIL_DELIVERY=log`, so emails are printed in the terminal instead of sent.
Settings also shows the delivery log (failed messages are retried and can be retried by hand) and the
blocked senders.

**Moving the v1 requests** (once, at the cut-over): `npm run migrate-legacy` shows what would be copied,
`npm run migrate-legacy -- --apply` copies it, and `npm run migrate-legacy -- --verify` checks the copy. The
v1 data is only read, never changed.

### Clients, projects, tasks and time

- **Clients**: open an inbox message and press **Make the sender a client**; later messages from that address
  join the client's timeline by themselves. Log calls and meetings on the client's page. **Export data** and
  **Delete client** are for privacy requests (both ask to confirm it's you).
- **Projects**: **Start a project** from the message or the client. The board (`/admin/projects`) moves
  projects between stages with the mouse or the keyboard (focus a card, then `Shift` + arrows). Each project
  has tasks (its own board), revision rounds ("2 of 3 included rounds used"; extra rounds are marked billable),
  time and a health view.
- **Tasks** (`/admin/tasks`): Today, Overdue, Upcoming, Anytime and Someday lists. Keys: `n` new task, `j`/`k`
  move, `x` done. Repeating tasks move to their next date when you finish them.
- **Time**: the timer is in the sidebar (one runs at a time); the **Time** page is the week's timesheet, where
  you can also add time by hand.

### Calls and the calendar

- **Booking page**: `/book` lists the calls anyone can book; each type has its own link, such as
  `/book/intro-call`. Visitors pick a time in their own time zone and get a confirmation email with a
  calendar invite and a link to reschedule or cancel. Video calls use Jitsi Meet (free, no account needed);
  the room's link is in the invite. Emails need email delivery set up (see the inbox above).
- **Your hours**: **Calendar → Hours, rules and the calendar feed** sets the weekly hours, special dates, the
  gap after each call, the notice you need, how far ahead people can book and a daily limit. Blocks on the
  Calendar page (school, an exam, a trip) keep time free.
- **Booking types** (**Calendar → Booking types**): length, where the call happens, up to five questions,
  who can book it (*Anyone*, listed on `/book`; *Clients*, listed in their portal; or *Only people you send
  the link to*: copy the link from the type's card, **New link** retires the old one) and *I confirm each
  booking first*. Requests wait in the Calendar until you confirm or decline them; the sidebar shows how
  many.
- **Your own meetings**: **New meeting** on the Calendar or a client's page. It is confirmed at once, and the
  guest can get the invite by email.
- **In your calendar app**: turn on the calendar feed and subscribe to its address in Google Calendar (Other
  calendars → From URL), Apple Calendar or Outlook. It shows meetings, blocks and deadlines. Make a new
  address if the old one leaks.

### Quotes, invoices and getting paid

- **First, Billing → Settings**: your business details (they print on every quote and invoice), payment
  terms, and your bank accounts (IBANs are checked; changing them asks you to confirm it's you, and you get an
  email about it). Until you issue official e-Arşiv invoices, documents are titled *Payment request*.
- **Quotes**: **Write a quote** on an inbox message or **New quote** on a client. Pick lines from your
  services or type them, add a discount or taxes, choose how it's paid (all upfront, 50/50 or 40/30/30), then
  **Send**. The client gets a link where they read it, download the PDF and accept or decline it. Accepting
  creates the project with its payment milestones and emails the first invoice.
- **Invoices**: **New invoice** (or from a project). A draft can change; **Issue** gives it its number and
  emails it, and from then on it's fixed: void it (only if nothing is paid) or make a credit note. The
  client's link shows only the ways to pay you allowed on that invoice.
- **Payments**: a bank transfer that arrived is recorded on the invoice with **Record a bank transfer** (the
  client gets a receipt). Crypto payments (NOWPayments) confirm themselves: the invoice turns paid and you
  get an email. Anything unusual (a part payment, the wrong amount) waits in **Billing → Payments** for you
  to count what arrived or mark it failed.
- **Recurring invoices** (care plans, hosting): **Billing → Recurring → New plan**. Write `{period}` where the
  month should go, like *Care plan: {period}*; each invoice is issued on its date and emailed.
- **Reminders**: clients get a friendly reminder a day, a week and two weeks after an invoice is due. Stop
  them on the invoice's page if a client has promised to pay.
- **Crypto set-up**: create a NOWPayments account (try their sandbox first), then set `NOWPAYMENTS_API_KEY`
  and `NOWPAYMENTS_IPN_SECRET` (Settings → Payments → IPN in NOWPayments). Ask an accountant about crypto
  income before going live.

### Finance

- **Finance → Overview**: income, expenses and profit month by month, who paid most, what you spend on, and
  what clients owe you by how late it is, all in lira (or the base currency in Billing → Settings) at TCMB's
  rate of each day. Rates are fetched twice a day; **Exchange rates** shows them.
- **Expenses**: add what you pay for hosting, software, fees or hardware, with the receipt's number.
- **Export**: a CSV for your accountant with every payment, refund and expense, in a form Excel opens on a
  Turkish Windows.

### The client portal (`/portal`)

- **Inviting a client**: **Invite to the portal** on the client's page emails them a sign-in link valid for a
  week (clients who accept a quote are invited by themselves). Later they type their address at
  `/portal/login` and get a new link, valid for 20 minutes. There are no client passwords.
- **What they see**: their projects with the steps, your updates and the links you share, their revision
  rounds, invoices and quotes (paid from the invoice's own page), their calls and the booking types for
  clients, and their details.
- **On a project's page**: **Post the update** ("the staging site is up") shows it in their portal, and
  emails it if you leave the box ticked. Tick **Shared** next to a link to show it to them.
- **Revision requests** from the portal arrive like the ones you add, marked *from the portal*, with an email
  and a Discord message. A round past the included ones is only sent after the client agrees to its price.
- **Data requests**: a client can ask for a copy of their data or its deletion. They show on the client's
  page (and you get an email). For a copy, send them the file from **Export data**, then mark the request
  done with a note. For a deletion, **Delete client** is the answer: the request goes with the rest of their
  data, and the audit log keeps the record. Answer within 30 days.
- **Turn off** on the client's page closes their portal and signs them out everywhere; **Sign out
  everywhere** there signs them out but leaves the portal on.

### Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev:db` | Local MongoDB (replica set) on port 27027, applies migrations |
| `npm run dev` | Development server with hot reload |
| `npm run migrate` | Applies pending migrations to the database in `MONGO_URL` (`npm run migrate -- --status` only lists them) |
| `npm run migrate-legacy` | Copies the v1 requests into the inbox (dry run; `-- --apply` to copy, `-- --verify` to check) |
| `npm run backup` | Writes an encrypted backup to `BACKUP_DIR` now (the server also makes one every night) |
| `npm run restore -- <file> --check` | Restore drill: restores a backup into a temporary database, compares, deletes it |
| `npm run admin -- <command>` | Owner account tools: `create`, `status`, `reset-password`, `reset-2fa`, `unlock` |
| `npm run build`, then `npm start` | Production build, started the way the server runs it |
| `npm run lint`, `npm run typecheck`, `npm run format` | Code checks and formatting |
| `npm run test:unit`, `npm run test:integration` | Tests (the integration tests start their own MongoDB) |
| `npm run build`, then `npm run test:e2e` | Browser tests (first time: `npx playwright install chromium`) |

### Going live

The server setup, the Cloudflare Tunnel, the switch from v1, deploys, rollbacks and restoring a backup are in
[docs/DEPLOY.md](docs/DEPLOY.md). In short: `install-service.ps1` once, then `deploy.ps1` for every update.

### Configuration

Every variable is documented in [`.env.example`](.env.example). The app checks them when it starts and prints
a plain-English list of anything wrong (for example a doubled `MONGO_URL=`), instead of a stack trace.
Health check: `GET /api/health` (public) and `GET /api/health?deep=1` with the `x-health-token` header set to
`HEALTH_TOKEN` (configuration, database and migrations).

---

# v1 (current live site)

A personal portfolio and blog web application built with a modern web stack. The project features a React (Vite) frontend, a FastAPI backend, and a MongoDB database.

---

## Tech Stack

### Frontend
- **React 19** & **Vite** - High-performance frontend library and build tool
- **Tailwind CSS** - Utility-first styling framework
- **React Router DOM** - Client-side routing for multi-page navigation and dynamic blog routes
- **shadcn/ui** & **Radix UI** - Accessible and customizable UI component primitives
- **Axios** - HTTP client for backend API communication
- **Lucide React** - Icon library
- **Sonner & Toast** - Toast notification management

### Backend & Database
- **FastAPI** - High-performance asynchronous Python API framework
- **MongoDB** & **Motor** - Asynchronous MongoDB driver for python
- **Pydantic v2** - Data validation and settings management using python type annotations
- **Uvicorn** - ASGI web server implementation

---

## Project Structure

```text
leffloard.xyz/
├── frontend/                     # React application codebase
│   ├── src/
│   │   ├── components/           # UI components (Hero, About, Blog, etc.)
│   │   │   ├── ui/               # Low-level UI primitives (Button, Input, etc.)
│   │   │   ├── admin/            # Admin panel served at /admin
│   │   │   ├── RequestForm.jsx   # Appointment, revision and inquiry form
│   │   │   └── ...
│   │   ├── data/                 # Static mock data or configurations
│   │   ├── hooks/                # Custom React hooks
│   │   ├── lib/                  # Shared utility code
│   │   ├── App.jsx               # Main application component
│   │   └── main.jsx              # Application entry point
│   ├── tailwind.config.js        # Tailwind CSS configuration
│   └── package.json              # NPM dependencies and script definitions
│
├── backend/                      # FastAPI application codebase
│   ├── server.py                 # App setup, API routes and frontend hosting
│   ├── schemas.py                # Validation rules for requests and admin updates
│   ├── notify.py                 # Discord webhook and email notifications
│   ├── security.py               # Admin tokens, password checks and rate limiting
│   ├── config.py                 # Settings read from backend/.env
│   ├── hash_password.py          # Generates the admin password hash
│   ├── requirements.txt          # Runtime dependencies
│   ├── requirements-dev.txt      # Test dependencies
│   └── .env.example              # Documented configuration template
│
├── tests/                        # Backend API test suite (pytest)
├── pytest.ini                    # Test runner configuration
│
└── egefitnessalwaysinbussinies.bat # Convenience startup batch script (Windows)
```

---

## Getting Started

Follow the [Manual Installation](#manual-installation) steps once to install the dependencies and create `backend/.env`. After that, the [development shortcut](#development-shortcut-windows) can start both servers on Windows.

---

## Manual Installation

### Prerequisites
- Node.js 20.19 or newer (required by Vite 7)
- Python 3.11 or newer (3.11 to 3.14 are supported, on Windows and Linux)
- MongoDB: a local MongoDB Community Server or a free MongoDB Atlas cluster

### Backend Setup
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create and activate a virtual environment:
   ```bash
   python -m venv venv
   # Windows:
   venv\Scripts\activate
   # macOS/Linux:
   source venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Create your configuration file from the template. Every variable is explained in `.env.example`:
   ```bash
   copy .env.example .env
   # macOS/Linux:
   cp .env.example .env
   ```
5. Point `MONGO_URL` and `DB_NAME` at your database (see [MongoDB](#mongodb) below).
6. Create the admin login for `/admin`. The script asks for the password twice and prints the lines to paste into `.env`:
   ```bash
   python hash_password.py --secret
   ```
   This prints `ADMIN_PASSWORD_HASH=...` and a random `ADMIN_JWT_SECRET=...`. Only the hash is stored, never the password. Until both values are set, the admin API answers `503 Admin panel is not configured.`
7. Optionally configure notifications (see [Notifications](#notifications)). Each channel is skipped while it is not configured.
8. Run the server:
   ```bash
   python -m uvicorn server:app --reload
   ```
   The API is available at `http://127.0.0.1:8000/api`, with interactive documentation at `http://127.0.0.1:8000/api/docs`. The startup log shows whether the admin panel, Discord and email are enabled, and warns about invalid values.

#### MongoDB
- **Local:** install [MongoDB Community Server](https://www.mongodb.com/try/download/community) (the Windows installer can run it as a service) and use `MONGO_URL=mongodb://localhost:27017`.
- **MongoDB Atlas (free tier):** create an M0 cluster, add a database user under *Database Access*, allow your server's IP address under *Network Access*, then copy the driver connection string (`mongodb+srv://<user>:<password>@<cluster>.mongodb.net/...`) into `MONGO_URL`.

The `requests` collection and its indexes are created automatically on startup.

#### Notifications
Every new request is stored in MongoDB (visible in the admin panel) and, when configured, also sent to Discord and by email. Notifications are sent in the background after the visitor has received a response, so a slow or failing channel never affects the form; failures are logged.
- **Discord:** in your server open *Server Settings -> Integrations -> Webhooks -> New Webhook*, pick the channel, then *Copy Webhook URL* and set `DISCORD_WEBHOOK_URL`. Treat the URL as a secret. Messages never ping anyone.
- **Email (Gmail example):** turn on 2-Step Verification for the Google account, create an app password at <https://myaccount.google.com/apppasswords>, then set:
  ```env
  SMTP_HOST=smtp.gmail.com
  SMTP_PORT=587
  SMTP_SECURITY=starttls
  SMTP_USERNAME=you@gmail.com
  SMTP_PASSWORD=your16charapppassword
  SMTP_FROM=leffloard.xyz <you@gmail.com>
  NOTIFY_EMAIL_TO=you@gmail.com
  ```
  Notification emails use the client's address as Reply-To, so you can answer directly. The same SMTP settings are used when you choose to email a client about a status change from the admin panel.

Set `SITE_URL` (for example `https://leffloard.xyz`) so notifications include a link to the admin panel.

#### Running the tests
From the repository root:
```bash
pip install -r backend/requirements-dev.txt
python -m pytest -q
```
The tests use an in-memory MongoDB replacement and mocked Discord/SMTP senders, so no database or network access is needed.

### Frontend Setup
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```
   The frontend interface will be available at `http://localhost:5173`. Requests to `/api` are proxied to the backend at `http://127.0.0.1:8000`, so start the backend first to use the contact form and `/admin`.

### Development shortcut (Windows)
`egefitnessalwaysinbussinies.bat` in the root directory opens a new command prompt window running the FastAPI server with `--reload` and runs the Vite development server in the current window:
```cmd
egefitnessalwaysinbussinies.bat
```
It is the author's own shortcut: it expects the project at `C:\Users\Leff\Desktop\leffloard.xyz` and uses the global `python`, so edit the paths (for example to `backend\venv\Scripts\python.exe`) if your setup differs. It starts development servers only; see [Deployment](#deployment) for running the site in production.

---

## API Endpoints

All endpoints live under `/api` and exchange JSON. Interactive documentation is available at `/api/docs`.

| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| **GET** | `/api/health` | Public | Health check, returns `{"ok": true}`. |
| **POST** | `/api/requests` | Public | Submits an appointment, revision or general inquiry request. |
| **POST** | `/api/admin/login` | Public | Exchanges the admin password for a bearer token valid for 12 hours. |
| **GET** | `/api/admin/me` | Admin | Reports which notification channels are configured: `discord`, `email` (new-request emails to you) and `client_email` (status emails to clients, which only need the SMTP settings). |
| **GET** | `/api/admin/requests` | Admin | Lists requests, newest first. Query: `status`, `type`, `q` (searches name, email, subject and project reference), `page`, `limit` (max 100). Returns `items`, `total` and per-status `counts`. |
| **GET** | `/api/admin/requests/{id}` | Admin | Returns one request. |
| **PATCH** | `/api/admin/requests/{id}` | Admin | Updates `status`, `admin_note` or `scheduled_at` (appointments only, ISO 8601 with offset). With `notify_client: true` and an optional `client_message`, emails the client; the response includes `client_notified`. |
| **DELETE** | `/api/admin/requests/{id}` | Admin | Deletes a request. |

Admin endpoints require the header `Authorization: Bearer <token>` and answer `401 Not authenticated.` for a missing, invalid or expired token.

### Submitting a request
`POST /api/requests` accepts:

| Field | Required | Rules |
| :--- | :--- | :--- |
| `type` | Always | `appointment`, `revision` or `inquiry` |
| `name` | Always | 1-80 characters |
| `email` | Always | Valid address, up to 254 characters |
| `subject` | Always | 1-120 characters |
| `message` | Always | 1-4000 characters, line breaks allowed |
| `contact_handle` | No | Discord or Telegram handle, up to 80 characters |
| `service` | No | `Web Development`, `Discord Bot`, `Authentication System`, `Loader / Desktop App` or `Other` |
| `project_reference` | Revisions | Project or order name, up to 120 characters |
| `preferred_date` | Appointments | `YYYY-MM-DD`, from today up to 120 days ahead in the client's time zone |
| `preferred_time` | Appointments | `HH:MM`, 24-hour clock |
| `timezone` | Appointments | IANA time zone name, e.g. `Europe/Istanbul` |
| `duration_minutes` | No | Appointments only: 15, 30, 45 or 60 (default 30) |

Text is trimmed and control characters are rejected. Scheduling fields are ignored for other request types, and unknown fields are ignored.

- `201` returns `{"id", "status": "new", "created_at"}`.
- `422` returns `{"detail": [{"field": "...", "message": "..."}]}` so the form can show each message next to its field.
- `429` is returned after 5 accepted submissions from the same IP address within 10 minutes. Admin login allows 5 failed attempts per IP address per 15 minutes. IPv6 addresses count per `/64` network, and behind a proxy see [`TRUST_PROXY`](#https-with-a-reverse-proxy-or-cloudflare-tunnel).

Request statuses are `new`, `confirmed`, `declined` and `completed`; every status change is recorded in the request's `history`.

---

## Component Architecture

The React interface is composed of modular components:
- **Hero**: Landing area introduction.
- **About**: Biography and personal summary.
- **Skills**: Visualization of technical proficiencies.
- **Experience & Education**: Timeline representation of career and academic milestones.
- **Projects**: Portfolio listing and search interface.
- **Pricing**: Freelance rates and package matrices.
- **Blog & BlogDetails**: Layouts for listing posts and reading individual blog entries.
- **Contact**: Request form for booking a call, requesting a revision of delivered work or sending a general inquiry. Links such as `/?type=appointment#contact-form` (used by the header and the pricing page) preselect the request type, service and subject.
- **Admin** (`/admin`): Password-protected panel to review requests, filter and search them, confirm, decline or complete them, schedule appointments, keep private notes and optionally email the client about the update.

---

## Deployment

### Single server (recommended)
One Python process serves both the API and the built website, which suits a single Windows VDS or Linux VPS.

1. Build the frontend:
   ```bash
   cd frontend
   npm ci
   npm run build
   ```
   FastAPI serves `frontend/dist` automatically and answers client-side routes such as `/pricing`, `/blog/1` and `/admin` with `index.html`. Set `FRONTEND_DIST` if the build lives elsewhere. Unknown `/api/...` paths still return JSON `404` responses.
2. Configure `backend/.env` as described in [Backend Setup](#backend-setup), including `SITE_URL`. Leave `CORS_ORIGINS` empty, because the site and the API share one origin.
3. Start the server without `--reload`. From the `backend` directory, with the virtual environment activated:
   ```bash
   python -m uvicorn server:app --host 0.0.0.0 --port 8000
   ```
   The whole site is now available on port 8000. Open the port in the firewall if visitors connect to it directly.
4. Keep it running after reboots. A startup task or service neither starts in the `backend` directory nor activates the virtual environment, so give it full paths. The examples assume the project lives in `C:\leffloard.xyz`:
   - **Task Scheduler (Windows):** *Create Task*, choose *Run whether user is logged on or not*, add the trigger *At startup* and the action *Start a program* with:
     - Program/script: `C:\leffloard.xyz\backend\venv\Scripts\python.exe`
     - Add arguments: `-m uvicorn server:app --app-dir C:\leffloard.xyz\backend --host 0.0.0.0 --port 8000`
     - Start in: `C:\leffloard.xyz\backend`

     On the *Settings* tab, clear *Stop the task if it runs longer than*.
   - **NSSM (Windows service):**
     ```cmd
     nssm install leffloard C:\leffloard.xyz\backend\venv\Scripts\python.exe -m uvicorn server:app --app-dir C:\leffloard.xyz\backend --host 0.0.0.0 --port 8000
     nssm set leffloard AppDirectory C:\leffloard.xyz\backend
     nssm start leffloard
     ```
   - **systemd (Linux):** set `WorkingDirectory=/path/to/leffloard.xyz/backend` and `ExecStart=/path/to/leffloard.xyz/backend/venv/bin/python -m uvicorn server:app --host 0.0.0.0 --port 8000`.

#### HTTPS with a reverse proxy or Cloudflare Tunnel
For HTTPS on your own domain, run uvicorn on `--host 127.0.0.1` and put a reverse proxy (Caddy, nginx or IIS) or a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) in front of it, pointing to `http://127.0.0.1:8000` (use `127.0.0.1`, not `localhost`). A tunnel needs no open inbound ports.

Rate limiting counts requests per visitor address. Proxies add the address they received a request from to the end of the `X-Forwarded-For` header, after anything the visitor sent, so only the entries added by your own proxies can be trusted. `TRUST_PROXY` is the number of proxies between the visitor and uvicorn. A single proxy or tunnel on the same machine needs no setting, because uvicorn already reads the header on connections from `127.0.0.1` or `::1`:

| Setup | `TRUST_PROXY` |
| :--- | :--- |
| Visitors connect to uvicorn directly | `0` |
| A proxy or tunnel on the same machine (Caddy, nginx, IIS, `cloudflared`) connects to `127.0.0.1` | `0` |
| Cloudflare's proxy (orange cloud) or another proxy on a different machine connects to uvicorn | `1` |
| Cloudflare's proxy (orange cloud) in front of nginx or IIS on the same machine | `2` |

Never set a number higher than the real number of proxies, and with `1` or more make sure visitors cannot bypass the proxy (for Cloudflare, only allow [Cloudflare's IP ranges](https://www.cloudflare.com/ips/) through the firewall); otherwise a visitor can choose the address the rate limiter sees. Never start uvicorn with `--forwarded-allow-ips="*"` for the same reason. The startup log mentions the setting when it is not `0`.

### Split hosting
The frontend can also be hosted as static files (Netlify, Vercel, GitHub Pages) with the API on a separate server:

1. Build the frontend with the API address, for example by creating `frontend/.env.production` containing:
   ```env
   VITE_API_URL=https://api.leffloard.xyz
   ```
   and running `npm run build`. Without `VITE_API_URL` the frontend calls `/api` on its own origin, which is what the single-server setup and the Vite development proxy use.
2. Configure the static host to rewrite unknown paths to `index.html`, so `/pricing` and `/admin` work on reload.
3. On the API server, set `CORS_ORIGINS` to the frontend origin(s), for example `CORS_ORIGINS=https://leffloard.xyz,https://www.leffloard.xyz`, and run uvicorn as above.

---

## License

Private personal project. All rights reserved.
