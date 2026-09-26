import "server-only";
import type { Db } from "mongodb";
import { clientIp } from "@/lib/ip";
import { limited } from "@/server/calendar/public";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { jsonResponse, readJsonPost } from "@/server/http";
import { currentPortalClient, type PortalContext } from "@/server/portal/dal";
import { PORTAL_MAX_BYTES, PORTAL_POST_LIMIT } from "@/server/portal/public";

// The start of every signed-in portal endpoint: a same-site JSON post, within the limit, from a signed-in
// client. Everything after it is scoped to that client.
export async function readPortalPost(
  request: Request,
): Promise<
  | { ok: true; db: Db; context: PortalContext; fields: Record<string, unknown>; ip: string }
  | { ok: false; response: Response }
> {
  const env = getEnv();
  const body = await readJsonPost(request, { siteUrl: env.SITE_URL, maxBytes: PORTAL_MAX_BYTES });
  if (!body.ok) return body;
  const db = await getDb();
  const ip = clientIp(request.headers, env.CLIENT_IP_SOURCE);
  const tooMany = await limited(db, "portal", ip, PORTAL_POST_LIMIT);
  if (tooMany) return { ok: false, response: tooMany };
  const context = await currentPortalClient();
  if (!context) {
    return { ok: false, response: jsonResponse({ error: "Your session has ended. Sign in again." }, 401) };
  }
  return { ok: true, db, context, fields: body.fields, ip };
}

// Zod's first message per field, for the form.
export function fieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) errors[issue.path.join(".") || "form"] ??= issue.message;
  return errors;
}
