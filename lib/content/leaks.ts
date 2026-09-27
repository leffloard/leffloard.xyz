// The leak check run before anything is published (and by `npm run content:lint`): secrets, addresses and
// identifiers that must never reach the public site, plus the owner's own list of words (client names,
// private domains). Pure, so the editor can show the same findings before saving.

export type LeakFinding = { rule: string; label: string; excerpt: string };

type Rule = { rule: string; label: string; pattern: RegExp; allow?: (match: string) => boolean };

const OWNER_EMAIL = "erzincanligotik@gmail.com";

// Documentation, loopback and "any" addresses are fine to write about.
function harmlessIp(ip: string): boolean {
  return (
    ip === "0.0.0.0" ||
    ip.startsWith("127.") ||
    ip.startsWith("192.0.2.") ||
    ip.startsWith("198.51.100.") ||
    ip.startsWith("203.0.113.")
  );
}

function harmlessEmail(address: string): boolean {
  const lower = address.toLowerCase();
  return (
    lower === OWNER_EMAIL ||
    /@(?:example\.(?:com|org|net)|[\w-]+\.(?:test|example|invalid|localhost))$/.test(lower)
  );
}

// A value in an environment-variable line that is a placeholder, not a real value.
function placeholderValue(line: string): boolean {
  const value = line.slice(line.indexOf("=") + 1);
  return /^(?:<|\$|"\$|\.\.\.|your|example|changeme|xxx)/i.test(value);
}

const RULES: Rule[] = [
  {
    rule: "discord-webhook",
    label: "A Discord webhook address",
    pattern: /discord(?:app)?\.com\/api\/webhooks\/\S+/gi,
  },
  { rule: "discord-id", label: "A Discord id (17 to 20 digits)", pattern: /\b\d{17,20}\b/g },
  {
    rule: "database-address",
    label: "A database address with a password",
    pattern: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[^\s/@:]+:[^\s/@]+@\S+/gi,
  },
  { rule: "private-key", label: "A private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { rule: "aws-key", label: "An AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { rule: "api-key", label: "An API key", pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g },
  {
    rule: "github-token",
    label: "A GitHub token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g,
  },
  { rule: "slack-token", label: "A Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  {
    rule: "jwt",
    label: "A signed token (JWT)",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
  {
    rule: "env-secret",
    label: "A secret from a settings file",
    // Bounded, so a long line of capitals can't make the check slow.
    pattern:
      /^[A-Z][A-Z0-9_]{0,40}(?:SECRET|TOKEN|PASSWORD|PASS|KEY|URL|URI|DSN|WEBHOOK)[A-Z0-9_]{0,40}=\S{6,}/gm,
    allow: placeholderValue,
  },
  {
    rule: "ip-address",
    label: "An IP address",
    pattern: /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g,
    allow: harmlessIp,
  },
  {
    rule: "email",
    label: "Someone's email address",
    // Starting where a word starts, with bounded parts: a long unbroken token stays fast to check.
    pattern: /(?<![\w.+-])[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/g,
    allow: harmlessEmail,
  },
  {
    rule: "phone",
    label: "A phone number",
    pattern:
      /\+90[\s(]*\d[\d\s()-]{8,}|\(\d{3}\)\s?\d{3}[-\s]\d{4}|\b05\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g,
  },
];

// Shows enough of a match to find it, never all of a secret.
function excerpt(match: string): string {
  const flat = match.replace(/\s+/g, " ");
  return flat.length <= 12 ? flat : `${flat.slice(0, 8)}…`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findLeaks(text: string, bannedWords: readonly string[] = []): LeakFinding[] {
  const findings: LeakFinding[] = [];
  const seen = new Set<string>();
  const add = (finding: LeakFinding) => {
    const key = `${finding.rule}:${finding.excerpt}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(finding);
    }
  };
  for (const { rule, label, pattern, allow } of RULES) {
    for (const match of text.matchAll(pattern)) {
      if (allow?.(match[0])) continue;
      add({ rule, label, excerpt: excerpt(match[0]) });
    }
  }
  for (const word of bannedWords) {
    const trimmed = word.trim();
    if (!trimmed) continue;
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(trimmed)}(?![\\p{L}\\p{N}])`, "iu");
    if (pattern.test(text)) add({ rule: "banned-word", label: "A word on your list", excerpt: trimmed });
  }
  return findings;
}

// Fields that are never published (the note about a testimonial's permission), and what the server renders
// from the Markdown (checked through the Markdown itself).
const NOT_SCANNED = new Set(["consentNote", "html", "lead", "sections", "headings"]);

// Every piece of text in a content item that visitors could see, as written.
export function publishedText(data: unknown, skip: ReadonlySet<string> = NOT_SCANNED): string {
  const parts: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") parts.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) if (!skip.has(key)) walk(inner);
    }
  };
  walk(data);
  return parts.join("\n");
}

function decodeReferences(html: string): string {
  return html
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d{1,7});/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/g,
      (_, name: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[name as "amp"],
    );
}

// What the rendered Markdown gives a browser: character references decoded (so "&#64;" or "Ac&#109;e" can't
// hide from the check), attribute values included (link addresses, image descriptions).
export function renderedText(data: unknown): string {
  const parts: string[] = [];
  const walk = (value: unknown, key: string | null) => {
    if (typeof value === "string") {
      if (key === "html" || key === "lead") parts.push(decodeReferences(value));
    } else if (Array.isArray(value))
      value.forEach((item) => walk(item, key === "sections" ? "section" : key));
    else if (value && typeof value === "object") {
      for (const [inner, child] of Object.entries(value)) walk(child, inner);
    }
  };
  walk(data, null);
  return parts.join("\n");
}

// Everything the check looks at in a content item.
export function checkedText(data: unknown): string {
  return `${publishedText(data)}\n${renderedText(data)}`;
}
