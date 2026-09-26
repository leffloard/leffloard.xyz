import "server-only";
import { cookies, headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { cache } from "react";
import { audit } from "@/server/auth/audit";
import { cookieName } from "@/server/auth/cookies";
import { currentClient } from "@/server/auth/request";
import { findValidSession } from "@/server/auth/sessions";
import type { SessionDoc, UserDoc } from "@/server/auth/types";
import { findUserById } from "@/server/auth/users";
import { getDb } from "@/server/db/client";
import { verifyCloudflareAccess } from "@/server/security/cloudflare-access";

// The data access layer for the admin. Every admin page, action and route handler goes through these
// functions; nothing else reads the session cookie.

export type AdminContext = { user: UserDoc; session: SessionDoc };

// When Cloudflare Access guards /admin, a request without a valid Access token never reaches the admin,
// even with a stolen session cookie.
export const accessAllowed = cache(async (): Promise<boolean> => {
  const result = await verifyCloudflareAccess(await headers());
  if (!result.ok) {
    const client = await currentClient();
    await audit(await getDb(), {
      action: "auth.access.denied",
      ip: client.ip,
      userAgent: client.userAgent,
      details: { reason: result.reason },
    });
  }
  return result.ok;
});

export const currentAdmin = cache(async (): Promise<AdminContext | null> => {
  if (!(await accessAllowed())) return null;
  const token = (await cookies()).get(cookieName("session"))?.value;
  if (!token) return null;
  const db = await getDb();
  const session = await findValidSession(db, token);
  if (!session) return null;
  const user = await findUserById(db, session.userId);
  return user ? { user, session } : null;
});

// For admin pages: signed in, or off to the sign-in page.
export async function requireAdmin(): Promise<AdminContext> {
  if (!(await accessAllowed())) forbidden();
  const admin = await currentAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}

// For the sign-in pages themselves: Access still applies.
export async function requireAccess(): Promise<void> {
  if (!(await accessAllowed())) forbidden();
}
