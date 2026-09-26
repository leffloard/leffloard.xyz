import { cookies } from "next/headers";
import { currentAdmin } from "@/server/auth/dal";
import { cookieName, cookieOptions } from "@/server/auth/cookies";
import { PREVIEW_MS, startPreview } from "@/server/content/preview";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { readBodyText } from "@/server/http";
import { isSameOriginRequest } from "@/server/security/origin";

// Starts the owner's preview of drafts (an hour) and opens the page asked for. A form post from the content
// editor; behind the admin's sign-in and Cloudflare Access like the rest of /admin.

export const dynamic = "force-dynamic";

// The public pages that show content.
const PREVIEW_PATH = /^\/(?:(?:work|blog|services)(?:\/[a-z0-9-]+)?|pricing|cv|about)?$/;

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request.headers, getEnv().SITE_URL)) {
    return new Response("Cross-site posts are not accepted.", { status: 403 });
  }
  const admin = await currentAdmin();
  if (!admin) return new Response("Sign in to the admin first.", { status: 401 });
  const to = new URLSearchParams((await readBodyText(request, 2048)) ?? "").get("to") ?? "/";
  const token = await startPreview(await getDb(), admin.session._id);
  (await cookies()).set(cookieName("preview"), token, cookieOptions("preview", PREVIEW_MS / 1000));
  return new Response(null, { status: 303, headers: { location: PREVIEW_PATH.test(to) ? to : "/" } });
}
