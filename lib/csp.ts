// Content Security Policy builder, used by proxy.ts.
//
// Pages rendered per request (admin, client portal, link pages) get a nonce policy: only scripts carrying
// the per-request nonce, and what they load ('strict-dynamic'), can run. Prerendered public pages cannot
// carry a nonce, so they allow inline scripts but no script from anywhere except this site and Turnstile.

export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
export const CSP_REPORT_PATH = "/api/csp-report";

export type CspOptions = {
  nonce?: string;
  dev: boolean;
};

export function contentSecurityPolicy({ nonce, dev }: CspOptions): string {
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
  if (!dev) directives.push(["upgrade-insecure-requests"]);
  return directives.map((parts) => parts.join(" ")).join("; ");
}

// Paths rendered per request, which get the nonce policy.
const DYNAMIC_PREFIXES = ["/admin", "/portal", "/q/", "/i/", "/pay", "/meeting/"];

export function isDynamicPath(pathname: string): boolean {
  return DYNAMIC_PREFIXES.some((prefix) =>
    prefix.endsWith("/")
      ? pathname.startsWith(prefix)
      : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
