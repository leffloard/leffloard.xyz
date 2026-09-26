import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, CSP_REPORT_PATH, isDynamicPath } from "@/lib/csp";

// Response headers, CSP nonces and request ids only. Authorization never lives here: every page, action
// and route handler checks access itself, so a request that skips the proxy gains nothing.
export function proxy(request: NextRequest): NextResponse {
  const requestId = crypto.randomUUID();
  const dynamic = isDynamicPath(request.nextUrl.pathname);
  const nonce = dynamic
    ? Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64")
    : undefined;
  const policy = contentSecurityPolicy({ nonce, dev: process.env.NODE_ENV === "development" });

  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);
  // Next.js takes the nonce from the request's CSP header while rendering; a client must not choose it.
  headers.delete("content-security-policy");
  headers.delete("x-nonce");
  if (nonce) {
    headers.set("content-security-policy", policy);
    headers.set("x-nonce", nonce);
  }

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-request-id", requestId);
  response.headers.set("content-security-policy", policy);
  response.headers.set("reporting-endpoints", `csp="${CSP_REPORT_PATH}"`);
  if (dynamic) response.headers.set("x-robots-tag", "noindex, nofollow");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
