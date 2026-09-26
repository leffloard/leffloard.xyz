// Email address check, the subset of Python's email-validator the v1 backend used (no DNS lookups, no
// SMTPUTF8): a dot-atom local part and a real domain name. Returns the address in its ASCII form, with the
// domain in lower case and international domains in punycode, or null when it is not a valid address.

const ATOM = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// Names that can never receive mail from the internet (RFC 6761 and friends).
const SPECIAL_USE = ["arpa", "invalid", "local", "localhost", "onion", "test"];
// Characters a URL parser would treat as something other than a host name.
const NOT_A_HOST = /[\s:/?#[\]@\\%<>"^`{|}]/;

function asciiDomain(input: string): string | null {
  if (!input || NOT_A_HOST.test(input)) return null;
  let domain = input.toLowerCase();
  // International domain names (IDNA) become punycode; the URL parser does that in browsers and Node.
  if (/[^\x00-\x7f]/.test(domain)) {
    try {
      domain = new URL(`http://${domain}`).hostname;
    } catch {
      return null;
    }
  }
  if (domain.length > 253) return null;
  const labels = domain.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null;
  if (/^\d+$/.test(labels.at(-1)!)) return null; // an IP address or a numeric top-level domain
  if (SPECIAL_USE.some((name) => domain === name || domain.endsWith(`.${name}`))) return null;
  return domain;
}

export function normalizeEmail(text: string): string | null {
  const at = text.lastIndexOf("@");
  if (at <= 0) return null;
  const local = text.slice(0, at);
  if (local.length > 64 || !local.split(".").every((part) => ATOM.test(part))) return null;
  const domain = asciiDomain(text.slice(at + 1));
  if (!domain) return null;
  const address = `${local}@${domain}`;
  return address.length <= 254 ? address : null;
}
