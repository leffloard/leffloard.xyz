// The CV, with nothing that cannot be backed by public work or the owner's own statement.
export const cv = {
  headline: "Independent software developer",
  summary:
    "Freelance developer since 2018, building websites, web apps, Discord bots and backend systems for small businesses and communities. I care about security, automated tests and clear communication, and I'm currently a high-school student.",
  experience: [
    {
      role: "Independent software developer",
      place: "Freelance, remote",
      period: "2018 – present",
      points: [
        "Web apps with Next.js, React, FastAPI and Flask, backed by MongoDB or SQLite.",
        "Discord bots in discord.py: support tickets, ledgers, dashboards and licensing, with SQLite or SQLAlchemy storage.",
        "Authentication systems with argon2id, two-step verification, passkeys and audit logs.",
        "Desktop tools for Windows in Python, and graphics programming in C++20 with OpenGL.",
        "An Android personal-finance app in Kotlin with Jetpack Compose.",
      ],
    },
  ],
  education: [{ place: "High school", detail: "Current student", period: "Ongoing" }],
  skills: [
    {
      group: "Languages",
      items: ["TypeScript", "Python", "C++20", "Kotlin", "SQL"],
      proof: ["leffloard-xyz", "partnership-ledger-bot", "miniengine", "cardtrack"],
    },
    {
      group: "Web",
      items: ["Next.js", "React", "Tailwind CSS", "FastAPI", "Flask"],
      proof: ["leffloard-xyz", "minecraft-server-status", "flask-invoice"],
    },
    {
      group: "Data",
      items: ["MongoDB", "SQLite", "SQLAlchemy", "Room"],
      proof: ["leffloard-xyz", "partnership-ledger-bot", "cardtrack"],
    },
    {
      group: "Bots and APIs",
      items: ["discord.py", "Claude API", "Gmail API", "REST"],
      proof: ["discord-ticket-system", "partnership-ledger-bot", "jarviscore"],
    },
    {
      group: "Security",
      items: ["argon2id", "TOTP", "Passkeys (WebAuthn)", "Content Security Policy"],
      proof: ["leffloard-xyz"],
    },
    {
      group: "Quality",
      items: ["pytest", "Vitest", "Playwright", "GitHub Actions"],
      proof: ["leffloard-xyz", "partnership-ledger-bot"],
    },
    {
      group: "Graphics and mobile",
      items: ["OpenGL", "GLSL", "Jetpack Compose"],
      proof: ["miniengine", "cardtrack"],
    },
  ],
  languages: [
    { name: "Turkish", level: "Native" },
    { name: "English", level: "Working proficiency" },
  ],
} as const;
