import "server-only";

// CSRF check for route handlers that change something (server actions have Next.js's own check). A
// browser always sends Origin on POST; a forged cross-site request carries the attacker's origin, which
// cannot match this site's address or the Host header the victim's browser sends.
export function isSameOriginRequest(headers: Headers, siteUrl: string): boolean {
  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  const origin = headers.get("origin");
  if (origin === null) return true; // not sent by a browser; cookies are what a CSRF attack abuses
  if (origin === "null") return false;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (originUrl.origin === new URL(siteUrl).origin) return true;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  return host !== null && originUrl.host === host;
}
