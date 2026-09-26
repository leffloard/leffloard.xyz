import { cookies } from "next/headers";
import { cookieName } from "@/server/auth/cookies";
import { endPreview } from "@/server/content/preview";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { isSameOriginRequest } from "@/server/security/origin";

// Ends the owner's preview of drafts (the banner's button) and goes back to the page, as published.

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const siteUrl = getEnv().SITE_URL;
  if (!isSameOriginRequest(request.headers, siteUrl)) {
    return new Response("Cross-site posts are not accepted.", { status: 403 });
  }
  const store = await cookies();
  await endPreview(await getDb(), store.get(cookieName("preview"))?.value);
  store.delete(cookieName("preview"));
  let back = "/";
  try {
    const referer = new URL(request.headers.get("referer") ?? "", siteUrl);
    if (referer.origin === new URL(siteUrl).origin) back = referer.pathname;
  } catch {
    // no usable referer: the home page
  }
  return new Response(null, { status: 303, headers: { location: back } });
}
