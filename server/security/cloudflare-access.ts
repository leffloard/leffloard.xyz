import "server-only";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { getEnv } from "@/server/env";

// Cloudflare Access sits in front of /admin in production. Access adds a signed JWT to every request it
// lets through; checking it here means a request that reached the app some other way is still refused.

export type AccessResult = { ok: true; skipped: boolean; email?: string } | { ok: false; reason: string };

let cachedKeys: { teamDomain: string; getKey: JWTVerifyGetKey } | undefined;

function keysFor(teamDomain: string): JWTVerifyGetKey {
  if (cachedKeys?.teamDomain !== teamDomain) {
    cachedKeys = {
      teamDomain,
      getKey: createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`)),
    };
  }
  return cachedKeys.getKey;
}

export async function verifyCloudflareAccess(
  headers: Headers,
  getKey?: JWTVerifyGetKey,
): Promise<AccessResult> {
  const { CF_ACCESS_TEAM_DOMAIN: teamDomain, CF_ACCESS_AUD: audience } = getEnv();
  if (!teamDomain || !audience) return { ok: true, skipped: true };

  const token = headers.get("cf-access-jwt-assertion");
  if (!token) return { ok: false, reason: "missing-token" };
  try {
    const { payload } = await jwtVerify(token, getKey ?? keysFor(teamDomain), {
      issuer: `https://${teamDomain}`,
      audience,
      algorithms: ["RS256"],
    });
    return { ok: true, skipped: false, email: typeof payload.email === "string" ? payload.email : undefined };
  } catch {
    return { ok: false, reason: "invalid-token" };
  }
}
