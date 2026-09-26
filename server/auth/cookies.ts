import "server-only";
import { getEnv } from "@/server/env";

// Over https the cookies use the __Host- prefix (Secure, whole site, no Domain), so no subdomain or plain-http
// page can set or overwrite them. Plain http is only for local development.

type CookieKind = "session" | "pending" | "webauthn" | "portal";

export function isSecureSite(): boolean {
  return getEnv().SITE_URL.startsWith("https://");
}

export function cookieName(kind: CookieKind): string {
  return isSecureSite() ? `__Host-lf_${kind}` : `lf_${kind}`;
}

export function cookieOptions(kind: CookieKind, maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: isSecureSite(),
    // The sessions (admin and portal) must survive following a link from an email; the short-lived sign-in
    // cookies are only ever sent by this site's own forms.
    sameSite: kind === "session" || kind === "portal" ? ("lax" as const) : ("strict" as const),
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
