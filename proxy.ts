import { NextResponse, type NextRequest } from "next/server";

// Headers and request ids only. Authorization never lives here: every page, action and route
// handler checks access itself, so a request that skips the proxy gains nothing.
export function proxy(request: NextRequest): NextResponse {
  const requestId = crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
