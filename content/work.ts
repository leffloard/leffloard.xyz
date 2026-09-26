// Portfolio. Public repositories link to their code; private projects are described from a facts sheet only:
// purpose, capabilities, architecture, practices and stack, never code, customers, addresses or revenue.

export type WorkItem = {
  slug: string;
  title: string;
  tagline: string;
  summary: string;
  year: string;
  kind: "Open source" | "Private" | "Landing page";
  category: "Web" | "Discord bots" | "Mobile" | "Desktop" | "Graphics";
  stack: string[];
  repo?: string;
  featured: boolean;
  // Two or three short, checkable facts shown on the featured cards.
  highlights?: string[];
  status: string;
  sections: { heading: string; paragraphs: string[]; points?: string[] }[];
};

export const work: WorkItem[] = [
  {
    slug: "leffloard-xyz",
    title: "leffloard.xyz",
    tagline: "This site, and the private system behind it that runs my client work.",
    summary:
      "A rebuild of my site as one Next.js app: a public portfolio outside, and inside an admin for inquiries, projects, meetings and invoices, guarded like a bank login.",
    year: "2026",
    kind: "Open source",
    category: "Web",
    stack: ["Next.js 16", "TypeScript", "MongoDB", "Tailwind CSS", "Playwright", "Vitest"],
    repo: "https://github.com/leffloard/leffloard.xyz",
    featured: true,
    highlights: ["Passkeys + authenticator codes", "150+ automated tests", "Nonce-based CSP"],
    status:
      "In progress: the public site and the admin's security are done; inbox, calendar and invoicing come next.",
    sections: [
      {
        heading: "Context",
        paragraphs: [
          "The first version was a portfolio template with a request form: React on the front, FastAPI and MongoDB behind it, and a small admin to read requests. It worked, but my actual work (briefs, calls, revisions, invoices) still lived in chat threads and notes.",
          "The goal of the rebuild: one place for all of it, with a public side simple enough for clients and an admin that I trust with money and client data.",
        ],
      },
      {
        heading: "Approach",
        paragraphs: [
          "One Next.js application replaces both the React frontend and the Python backend. The old site keeps running until the new one is ready, and the old request data is migrated without being modified, so switching back stays possible for two weeks.",
          "Everything ships in milestones, each with its own tests, and database changes are forward-only so any release can be rolled back by switching a folder.",
        ],
      },
      {
        heading: "Security",
        paragraphs: ["The admin assumes the password will leak one day, and plans for it:"],
        points: [
          "argon2id passwords plus a mandatory authenticator code, or a passkey (Windows Hello, Touch ID) on its own.",
          "Progressive lockouts per email address, and passkeys keep working while password sign-in is locked.",
          "Sessions stored as hashes, ended after 30 idle minutes; a fresh identity check before any security change.",
          "Authenticator secrets encrypted with AES-256-GCM; recovery codes stored only as keyed hashes.",
          "A nonce-based Content Security Policy on every admin page, and an audit log of every sign-in and change.",
        ],
      },
      {
        heading: "Testing",
        paragraphs: [
          "Every milestone arrives with tests: unit tests for the pure parts (the TOTP code is checked against the RFC 6238 vectors), integration tests against a real MongoDB replica set, and browser tests that fail on any console error or CSP violation, including a passkey sign-in through a virtual authenticator.",
        ],
      },
    ],
  },
  {
    slug: "partnership-ledger-bot",
    title: "Partnership ledger bot",
    tagline: "Bookkeeping for a two-person business, typed as ordinary chat messages.",
    summary:
      "A Discord bot that turns messages like “-500 tl server” into a ledger, converts currencies at the day's rate and settles who owes whom. An AI model helps read messages, but never touches the numbers.",
    year: "2026",
    kind: "Private",
    category: "Discord bots",
    stack: ["Python 3.11", "discord.py", "SQLAlchemy", "Claude API", "pytest"],
    featured: true,
    highlights: ["The AI never does the math", "119 automated tests", "TRY to USD at the day's rate"],
    status: "In daily use.",
    sections: [
      {
        heading: "Problem",
        paragraphs: [
          "Two partners shared income and expenses in a Discord channel. Every month the same argument came back: are costs taken out of the profit first, or is the profit split first and the costs shared afterwards?",
          "Both methods give the same result. The bot shows them side by side on every balance, which ended the argument.",
        ],
      },
      {
        heading: "How it works",
        paragraphs: [
          "Nobody has to learn a format. Messages like “+120 website deposit”, “-15 hosting” or “-500 tl server” become income, expenses and transfers; Turkish lira is converted to US dollars at that day's rate, and instalments are tracked until they are paid.",
          "The bot reacts with a check mark when it understood a message, and with a question mark plus its assumption when it was unsure. Ordinary chat is left alone.",
        ],
      },
      {
        heading: "Where the AI stops",
        paragraphs: [
          "A rule-based parser reads most messages. Only the ones it cannot read go to a small, fast model, whose only job is to pull fields out of the text. A stronger model answers free questions like “what did we earn this month?”.",
        ],
        points: [
          "The model never calculates an amount: sums, splits and balances are deterministic code.",
          "For questions, it receives figures that were already computed and is told not to derive new ones.",
          "It returns names, never identities; code maps names to partners and accounts, and an unknown name leads to a question instead of a record.",
          "Without an API key the bot keeps working; only the AI layer switches off.",
        ],
      },
      {
        heading: "Engineering",
        paragraphs: [
          "Python 3.11 with discord.py and SQLAlchemy. Money is never a float: amounts are stored as integer minor units and handed out as decimals, so the ledger always adds up. A single-instance lock stops a second copy of the bot from doubling every reply and AI call. It runs as a Windows service on a VDS, and 119 automated tests cover the parser, the ledger, the AI fallback and the bot's behaviour.",
        ],
      },
    ],
  },
  {
    slug: "miniengine",
    title: "MiniEngine",
    tagline: "A small C++20 OpenGL renderer with forward and deferred paths.",
    summary:
      "A learning engine that renders the same scene two ways, forward and deferred, switchable at runtime, with instanced drawing for thousands of objects in one draw call.",
    year: "2026",
    kind: "Open source",
    category: "Graphics",
    stack: ["C++20", "OpenGL 3.3", "GLSL", "CMake", "GLFW", "GLM"],
    repo: "https://github.com/leffloard/MiniEngine",
    featured: true,
    highlights: ["Forward and deferred paths", "Instanced drawing", "C++20, OpenGL 3.3"],
    status: "Experiment, kept small on purpose.",
    sections: [
      {
        heading: "What it does",
        paragraphs: [
          "MiniEngine is where I learn how renderers work under the frameworks. The scene is lit with Blinn-Phong shading in a forward pass, or split into a G-buffer and lit in a full-screen pass, and a key switches between the two at runtime.",
        ],
        points: [
          "Instanced rendering: large cube grids in a single draw call, for performance testing.",
          "A procedural skybox, textured materials and an optional ground grid.",
          "A scene of entities with transforms, materials and mesh references.",
          "A first-person camera with mouse look, WASD, zoom and adjustable speed; wireframe, VSync and FPS logging toggles.",
        ],
      },
      {
        heading: "Build",
        paragraphs: [
          "About 1,800 lines of C++20, plus the GLSL shaders. CMake fetches GLFW, GLAD, GLM and stb_image on the first configure, so the project builds with MSVC, GCC or Clang without manual setup.",
        ],
      },
    ],
  },
  {
    slug: "cardtrack",
    title: "CardTrack",
    tagline: "Credit cards, cash and budgets in one Android app, with real statement-cycle logic.",
    summary:
      "A personal finance app that calculates card debt by statement cycle, spreads instalments across months and warns when your cash will not cover what is due.",
    year: "2026",
    kind: "Open source",
    category: "Mobile",
    stack: ["Kotlin", "Jetpack Compose", "Room", "KSP", "Biometric API", "MVVM"],
    repo: "https://github.com/leffloard/CardTrack",
    featured: false,
    status: "My first Kotlin project. I used AI as a tutor for the language basics; the app logic is mine.",
    sections: [
      {
        heading: "What it does",
        paragraphs: [
          "Most finance apps treat a credit card as a single balance. CardTrack follows the statement cycle, so it knows what is due this month and what rolls into the next.",
        ],
        points: [
          "Cash-gap analysis: will your assets cover the upcoming payments?",
          "Instalments distributed across the right months automatically.",
          "Monthly budgets per category.",
          "Fingerprint or face unlock, and a privacy mode that hides every balance with one tap.",
        ],
      },
      {
        heading: "Build",
        paragraphs: [
          "Kotlin with Jetpack Compose, a Room database generated with KSP, and an MVVM structure that keeps the banking logic out of the UI.",
        ],
      },
    ],
  },
  {
    slug: "discord-ticket-system",
    title: "Discord ticket system",
    tagline: "Support tickets in Discord that survive restarts and keep a transcript of every conversation.",
    summary:
      "A support ticket bot with dropdown categories, persistent buttons, per-ticket permissions and an HTML transcript sent to a log channel when a ticket closes.",
    year: "2026",
    kind: "Open source",
    category: "Discord bots",
    stack: ["Python", "discord.py 2", "SQLite", "chat-exporter"],
    repo: "https://github.com/leffloard/discord-select-menu-ticket",
    featured: false,
    status: "Complete.",
    sections: [
      {
        heading: "What it does",
        paragraphs: [
          "Members pick a category from a dropdown and get a private channel with the right team. The panel's buttons and menus are registered as persistent views, so they keep working after the bot restarts, without reposting anything.",
        ],
        points: [
          "Separate categories for active and closed tickets.",
          "Ticket metadata and history in SQLite.",
          "HTML transcripts generated on close and delivered to a log channel.",
          "Role-based permission overrides per ticket, and a status line with the open ticket count.",
        ],
      },
    ],
  },
  {
    slug: "jarviscore",
    title: "JarvisCore",
    tagline: "A desktop voice assistant prototype with a wake word and a status overlay.",
    summary:
      "A Python voice assistant that wakes on its name, understands a few commands, reads your inbox for urgent-looking mail and answers with a natural voice.",
    year: "2026",
    kind: "Open source",
    category: "Desktop",
    stack: ["Python", "Tkinter", "SpeechRecognition", "Gmail API", "ElevenLabs", "Windows"],
    repo: "https://github.com/leffloard/JarvisCore",
    featured: false,
    status: "Prototype.",
    sections: [
      {
        heading: "What it does",
        paragraphs: [
          "JarvisCore listens for a wake word, recognises voice commands and replies with ElevenLabs text-to-speech. A small overlay shows its status alongside CPU and memory use.",
        ],
        points: [
          "Gmail inbox check for urgent-looking messages, through Google OAuth.",
          "Web search and shortcuts for YouTube and Google.",
          "Secrets kept out of the repository: environment variables for API keys, OAuth tokens ignored by Git.",
        ],
      },
    ],
  },
  {
    slug: "minecraft-server-status",
    title: "Minecraft server status page",
    tagline: "A small web page that shows whether a Minecraft server is up, and who is on it.",
    summary:
      "A Flask app showing a server's live status, player count, message of the day and icon, with sanitised text and a fallback when the server is offline.",
    year: "2026",
    kind: "Open source",
    category: "Web",
    stack: ["Python", "Flask", "Jinja", "mcsrvstat.us API"],
    repo: "https://github.com/leffloard/minecraft-smp-status-web",
    featured: false,
    status: "Complete.",
    sections: [
      {
        heading: "What it does",
        paragraphs: [
          "The page polls the public mcsrvstat.us API and renders the server's status in a dark, responsive layout. The message of the day is parsed and sanitised before display, and the server icon comes from the API's base64 data, with a local fallback.",
        ],
      },
    ],
  },
  {
    slug: "tirego",
    title: "TireGo",
    tagline: "A landing page for a roadside tire and tow assistance service.",
    summary:
      "A fast, single-page site for a service that connects drivers with nearby tire repair shops and tow trucks during roadside emergencies, with its own privacy page.",
    year: "2026",
    kind: "Landing page",
    category: "Web",
    stack: ["HTML", "CSS"],
    repo: "https://github.com/leffloard/tirego-site",
    featured: false,
    status: "Complete.",
    sections: [
      {
        heading: "What it does",
        paragraphs: [
          "Hand-written HTML and CSS, without a framework or a single script, so the page loads quickly on a phone at the roadside, when it matters. A separate privacy page explains what happens with the data drivers share.",
        ],
      },
    ],
  },
  {
    slug: "flask-invoice",
    title: "Income and expense tracker",
    tagline: "A lightweight web app for tracking income, expenses and the balance between them.",
    summary:
      "A Flask and SQLite app to add, edit and delete income and expense records, with automatic balance and profit or loss.",
    year: "2025",
    kind: "Open source",
    category: "Web",
    stack: ["Python", "Flask", "SQLite", "Bootstrap 5"],
    repo: "https://github.com/leffloard/flask-invoice",
    featured: false,
    status: "Complete. GPL licensed.",
    sections: [
      {
        heading: "What it does",
        paragraphs: [
          "Records are stored in US dollars in a file-based SQLite database, and the balance and profit or loss are recalculated on every change. The interface is plain Bootstrap: quick to build, easy to use.",
        ],
      },
    ],
  },
];

export function findWork(slug: string): WorkItem | undefined {
  return work.find((item) => item.slug === slug);
}

export const publicRepoCount = work.filter((item) => item.repo).length;
