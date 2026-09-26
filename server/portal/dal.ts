import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { cookieName } from "@/server/auth/cookies";
import type { ClientDoc } from "@/server/clients/types";
import { getDb } from "@/server/db/client";
import { findPortalSession } from "@/server/portal/access";
import type { PortalSessionDoc } from "@/server/portal/types";

// The client portal's data access layer: every portal page and endpoint finds its client here, and every query
// after it is scoped to that client. Nothing else reads the portal cookie.

export type PortalContext = { client: ClientDoc; session: PortalSessionDoc };

export const currentPortalClient = cache(async (): Promise<PortalContext | null> => {
  const token = (await cookies()).get(cookieName("portal"))?.value;
  if (!token) return null;
  return findPortalSession(await getDb(), token);
});

// For portal pages: signed in, or off to the sign-in page.
export async function requirePortalClient(): Promise<PortalContext> {
  const context = await currentPortalClient();
  if (!context) redirect("/portal/login");
  return context;
}
