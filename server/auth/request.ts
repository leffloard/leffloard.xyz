import "server-only";
import { headers } from "next/headers";
import { clientIp, ipKey } from "@/lib/ip";
import type { Client } from "@/server/auth/login";
import { getEnv } from "@/server/env";

// Who is making this request, for rate limits and the activity log.
export async function currentClient(): Promise<Client> {
  const requestHeaders = await headers();
  const ip = clientIp(requestHeaders, getEnv().CLIENT_IP_SOURCE);
  return {
    ip,
    ipKey: ipKey(ip) ?? "unknown",
    userAgent: (requestHeaders.get("user-agent") ?? "").slice(0, 300),
  };
}
