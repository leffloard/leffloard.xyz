// Services and starting prices. Prices are in US dollars; Turkish clients are quoted in lira.
// Every project gets a written quote; these are the floors, not the final number.

export type Package = {
  name: string;
  price: number; // "from" price in USD
  per?: "month";
  summary: string;
  includes: string[];
  revisions: number | null; // included revision rounds; null = agreed per project
  timeline: string;
  highlighted?: boolean;
};

export type Service = {
  slug: string;
  title: string;
  short: string;
  intro: string;
  forWhom: string;
  packages: Package[];
  addOns: { name: string; price: string }[];
  deliverables: string[];
  proof: string[]; // work slugs that show this kind of work
  faq: { q: string; a: string }[];
};

export const services: Service[] = [
  {
    slug: "websites",
    title: "Websites & web apps",
    short: "From a fast landing page to a web app with accounts, a database and an admin.",
    intro:
      "Sites that load fast, rank, and are easy for you to update, and web apps built on the same stack I use for my own business system.",
    forWhom:
      "Small businesses, freelancers and teams who need a site that sells, or a tool their customers log into.",
    packages: [
      {
        name: "Launch",
        price: 350,
        summary: "A focused site for one offer.",
        includes: [
          "1 to 3 pages",
          "Mobile-first design",
          "Contact form with spam protection",
          "Basic SEO and analytics",
        ],
        revisions: 1,
        timeline: "About 1 week",
      },
      {
        name: "Business",
        price: 1200,
        summary: "A complete site you edit yourself.",
        includes: [
          "Up to 8 pages",
          "Content editor for your team",
          "Booking or quote requests",
          "Blog, SEO and social previews",
        ],
        revisions: 2,
        timeline: "2 to 4 weeks",
        highlighted: true,
      },
      {
        name: "Web app",
        price: 3000,
        summary: "Software your customers or staff log into.",
        includes: [
          "Accounts and secure sign-in",
          "Database and admin panel",
          "Payments or integrations as needed",
          "Automated tests and deployment",
        ],
        revisions: 3,
        timeline: "From 4 weeks, in milestones",
      },
    ],
    addOns: [
      { name: "Extra page", price: "$90" },
      { name: "Online shop", price: "from $450" },
      { name: "Extra language", price: "$250" },
      { name: "Care plan: updates, backups, monitoring", price: "$49 or $99 / month" },
    ],
    deliverables: [
      "Source code in your own repository",
      "Deployment on your hosting or mine",
      "A short guide to editing and running it",
    ],
    proof: ["leffloard-xyz", "tirego", "minecraft-server-status", "flask-invoice"],
    faq: [
      {
        q: "Can I edit the site myself?",
        a: "Yes. The Business and Web app packages include an editor for your content, and I show you how to use it.",
      },
      {
        q: "Do you do hosting?",
        a: "I deploy on your hosting, or on mine with a care plan. Either way you own the domain and the code.",
      },
    ],
  },
  {
    slug: "discord-bots",
    title: "Discord bots",
    short: "Tickets, moderation, shops and custom workflows, running reliably 24/7.",
    intro:
      "Bots that keep working after restarts, keep their data in a real database, and leave an audit trail your moderators can trust.",
    forWhom: "Communities, game servers and businesses that run their support or sales in Discord.",
    packages: [
      {
        name: "Essentials",
        price: 180,
        summary: "A focused bot for one job.",
        includes: ["Up to 8 slash commands", "Buttons, menus and embeds", "Setup on your server"],
        revisions: 1,
        timeline: "3 to 5 days",
      },
      {
        name: "Pro",
        price: 480,
        summary: "A bot your community relies on.",
        includes: [
          "Up to 20 commands",
          "Tickets with transcripts",
          "Database and logging",
          "Roles and permissions per feature",
        ],
        revisions: 2,
        timeline: "1 to 2 weeks",
        highlighted: true,
      },
      {
        name: "Platform",
        price: 1200,
        summary: "A bot with a web dashboard.",
        includes: [
          "Web dashboard with sign-in",
          "Licensing or subscriptions",
          "Admin tools and statistics",
          "Automated tests",
        ],
        revisions: 3,
        timeline: "From 3 weeks, in milestones",
      },
    ],
    addOns: [
      { name: "Hosting and monitoring", price: "$15 / month" },
      { name: "Web dashboard for an existing bot", price: "from $450" },
    ],
    deliverables: ["Source code", "Hosting setup or instructions", "A command guide for your staff"],
    proof: ["discord-ticket-system", "partnership-ledger-bot"],
    faq: [
      {
        q: "Will the bot survive restarts?",
        a: "Yes. Buttons and menus are registered as persistent views and data lives in a database, so nothing is lost when the bot restarts.",
      },
      {
        q: "Can you work on an existing bot?",
        a: "Yes. I start with a short review of the code and tell you what I would keep, fix or rewrite, with a price for each.",
      },
    ],
  },
  {
    slug: "auth-and-licensing",
    title: "Auth & licensing",
    short: "Sign-in, two-step verification and license keys, done properly.",
    intro:
      "Authentication is where small mistakes become incidents. I build it the way I built the sign-in for my own admin: passkeys, two-step codes, lockouts and audit logs, all tested.",
    forWhom: "Products that need accounts, paid access or license keys for their software.",
    packages: [
      {
        name: "Auth kit",
        price: 450,
        summary: "Accounts done right.",
        includes: ["Sign-up and sign-in", "Password reset", "Two-step verification", "Session management"],
        revisions: 1,
        timeline: "1 to 2 weeks",
      },
      {
        name: "Licensing",
        price: 1200,
        summary: "License keys for your software.",
        includes: [
          "Key generation and activation",
          "Device limits and revocation",
          "API for your app",
          "Admin panel and logs",
        ],
        revisions: 2,
        timeline: "2 to 4 weeks",
        highlighted: true,
      },
      {
        name: "Platform",
        price: 2500,
        summary: "Accounts, billing and a customer portal.",
        includes: ["Customer portal", "Audit log", "Single sign-on", "Security review and tests"],
        revisions: 3,
        timeline: "From 5 weeks, in milestones",
      },
    ],
    addOns: [
      { name: "Review of an existing sign-in system", price: "$300" },
      { name: "Hosted license server", price: "$29 / month" },
    ],
    deliverables: [
      "Source code and API documentation",
      "A written threat model for your setup",
      "Tests for every sign-in path",
    ],
    proof: ["leffloard-xyz"],
    faq: [
      {
        q: "Can you add passkeys to my existing site?",
        a: "Usually, yes. Passkeys can sit next to passwords, so your users can switch at their own pace.",
      },
      {
        q: "Is licensing ever unbreakable?",
        a: "No licensing system is. The goal is to make it inconvenient to share keys and easy for you to see and revoke abuse.",
      },
    ],
  },
  {
    slug: "desktop-software",
    title: "Desktop software",
    short: "Windows tools and apps with an installer, auto-updates and licensing.",
    intro:
      "Desktop tools that install cleanly, update themselves and report crashes, from a small utility to a licensed client for your product.",
    forWhom:
      "Businesses that need an internal tool, and products that ship a desktop app to their customers.",
    packages: [
      {
        name: "Utility",
        price: 600,
        summary: "A tool that does one job well.",
        includes: ["Windows app with a clean interface", "Installer", "Automatic updates"],
        revisions: 1,
        timeline: "1 to 2 weeks",
      },
      {
        name: "Licensed client",
        price: 1400,
        summary: "A polished app for your customers.",
        includes: [
          "Polished interface",
          "License activation",
          "Automatic updates",
          "Crash and error reporting",
        ],
        revisions: 2,
        timeline: "3 to 5 weeks",
        highlighted: true,
      },
      {
        name: "Custom",
        price: 2500,
        summary: "Anything larger, in milestones.",
        includes: ["Architecture and plan", "Milestone deliveries", "Tests and documentation"],
        revisions: 3,
        timeline: "Agreed per project",
      },
    ],
    addOns: [
      { name: "Code signing setup", price: "on request" },
      { name: "Crash reporting dashboard", price: "on request" },
    ],
    deliverables: ["Source code", "Signed installer where a certificate is available", "Update server setup"],
    proof: ["jarviscore", "miniengine"],
    faq: [
      {
        q: "Windows only?",
        a: "Windows is where most of my desktop work runs. Cross-platform is possible when the project needs it; I'll say so in the quote.",
      },
    ],
  },
];

export function findService(slug: string): Service | undefined {
  return services.find((service) => service.slug === slug);
}

export const paymentTerms = [
  { title: "Under $500", text: "Paid in full before work starts." },
  { title: "$500 to $3,000", text: "50% to start, 50% on delivery." },
  { title: "Over $3,000", text: "40% to start, then 30% and 30% at agreed milestones." },
];

export const termsList = [
  "Every project starts with a written quote: scope, price, timeline and milestones. Quotes are valid for 14 days.",
  "Invoices are due within 7 days.",
  "Included revision rounds: 1, 2 or 3 depending on the package. Extra rounds cost $40 to $80, quoted up front.",
  "Rush delivery adds 30%, when the schedule allows it.",
  "The code and all rights to it are yours once the project is paid in full.",
];

export const paymentMethods = [
  { name: "Bank transfer", note: "Account details are on the invoice." },
  { name: "Cryptocurrency", note: "Through NOWPayments, confirmed automatically." },
  { name: "Card", note: "Coming soon." },
];

export const pricingFaq = [
  {
    q: "Why are the prices “from”?",
    a: "Because every project is a little different. The quote you get is fixed; the price on this page is where it starts.",
  },
  {
    q: "Do you work with Turkish clients?",
    a: "Yes. Quotes and invoices can be in Turkish lira, and we can talk in Turkish.",
  },
  {
    q: "What if something breaks after launch?",
    a: "Bugs in the delivered scope are fixed free of charge for 14 days after launch. After that, a care plan or a separate quote covers changes.",
  },
  {
    q: "Who owns the code?",
    a: "You do, once the project is paid in full. It lives in your repository from day one.",
  },
];
