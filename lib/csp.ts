// Content Security Policy builder, used by proxy.ts.
//
// Every page the app renders gets a nonce policy: only scripts carrying the per-request nonce, and what they
// load ('strict-dynamic'), can run. The one prerendered page, the 404 for addresses that match no route,
// cannot carry a nonce, so it allows inline scripts but no script from anywhere except this site and
// Turnstile.

export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
export const CSP_REPORT_PATH = "/api/csp-report";

export type CspOptions = {
  nonce?: string;
  dev: boolean;
  // The site is served over https (SITE_URL). Only then are http addresses upgraded: a production build
  // tried locally over plain http would otherwise have the browser fetch its icon over https.
  secure?: boolean;
};

export function contentSecurityPolicy({ nonce, dev, secure = true }: CspOptions): string {
  const scripts = nonce
    ? ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]
    : ["'self'", "'unsafe-inline'", TURNSTILE_ORIGIN];
  // React needs eval in development only (readable server error stacks in the browser).
  if (dev) scripts.push("'unsafe-eval'");
  // A nonce disables 'unsafe-inline', and development styles are injected without one.
  const styles = nonce && !dev ? ["'self'", `'nonce-${nonce}'`] : ["'self'", "'unsafe-inline'"];

  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    ["script-src", ...scripts],
    ["style-src", ...styles],
    // style="" attributes rendered on the server (positioning, CSS variables). They cannot run code.
    ["style-src-attr", "'unsafe-inline'"],
    ["img-src", "'self'", "blob:", "data:"],
    ["font-src", "'self'"],
    ["connect-src", "'self'"],
    ["frame-src", TURNSTILE_ORIGIN],
    ["worker-src", "'self'", "blob:"],
    ["manifest-src", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'none'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
    ["report-uri", CSP_REPORT_PATH],
    ["report-to", "csp"],
  ];
  if (!dev && secure) directives.push(["upgrade-insecure-requests"]);
  return directives.map((parts) => parts.join(" ")).join("; ");
}

function under(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) =>
    prefix.endsWith("/")
      ? pathname.startsWith(prefix)
      : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

// Signed-in pages and secret-link pages: rendered per request and kept out of search engines.
const PRIVATE_PREFIXES = ["/admin", "/portal", "/q/", "/i/", "/pay", "/meeting/"];

// Every route with pages. An address outside them gets the prerendered 404 page.
const PAGE_PREFIXES = [
  ...PRIVATE_PREFIXES,
  "/work",
  "/services",
  "/pricing",
  "/about",
  "/cv",
  "/blog",
  "/contact",
  "/book",
  "/legal",
  "/colophon",
];

export function isPrivatePath(pathname: string): boolean {
  return under(pathname, PRIVATE_PREFIXES);
}

// Whether an address is in one of the site's page sections (it may still be a 404 inside one).
export function inPageSection(pathname: string): boolean {
  return pathname === "/" || under(pathname, PAGE_PREFIXES);
}

export function usesNonce(pathname: string): boolean {
  return inPageSection(pathname);
}
