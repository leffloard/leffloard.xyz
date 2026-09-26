"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fail, ok, waitMessage } from "@/lib/action-result";
import { adminAction } from "@/server/auth/action";
import { audit } from "@/server/auth/audit";
import { cookieName, cookieOptions } from "@/server/auth/cookies";
import { currentAdmin } from "@/server/auth/dal";
import { confirmSudo } from "@/server/auth/login";
import { passkeyAssertionOptions, verifyPasskeyAssertion } from "@/server/auth/passkeys";
import { currentClient } from "@/server/auth/request";
import { revokeSession } from "@/server/auth/sessions";
import { getDb } from "@/server/db/client";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

export async function logoutAction(): Promise<void> {
  const admin = await currentAdmin();
  if (admin) {
    const db = await getDb();
    const client = await currentClient();
    await revokeSession(db, admin.user._id, admin.session._id);
    await audit(db, {
      action: "auth.logout",
      actorId: admin.user._id,
      ip: client.ip,
      userAgent: client.userAgent,
    });
  }
  (await cookies()).delete(cookieName("session"));
  redirect("/admin/login");
}

// --- "Confirm it's you" ------------------------------------------------------------------------------

export const confirmSudoAction = adminAction(
  z.object({
    password: z.string().min(1, "Enter your password.").max(1024),
    code: z.string().trim().min(1, "Enter a code.").max(64),
  }),
  async (input, { db, signedIn, client }) => {
    const result = await confirmSudo(db, input, signedIn, client);
    if (result.status === "rate_limited") return fail(waitMessage(result.retryAfterSeconds), "rate_limited");
    if (result.status === "invalid") return fail("The password or the code is not correct.");
    return ok(null);
  },
);

export const sudoPasskeyOptionsAction = adminAction(
  z.object({}),
  async (_input, { db, signedIn, client }) => {
    const result = await passkeyAssertionOptions(db, { kind: "sudo", signedIn }, client);
    if (result.status === "rate_limited") return fail(waitMessage(result.retryAfterSeconds), "rate_limited");
    (await cookies()).set(cookieName("webauthn"), result.token, cookieOptions("webauthn", 5 * 60));
    return ok(result.options);
  },
);

const assertion = z.looseObject({
  id: z.string().min(1).max(1024),
  rawId: z.string().min(1).max(1024),
  type: z.literal("public-key"),
  response: z.looseObject({
    clientDataJSON: z.string().max(10_000),
    authenticatorData: z.string().max(10_000),
    signature: z.string().max(10_000),
  }),
});

export const confirmSudoWithPasskeyAction = adminAction(
  assertion,
  async (response, { db, signedIn, client }) => {
    const jar = await cookies();
    const result = await verifyPasskeyAssertion(
      db,
      {
        token: jar.get(cookieName("webauthn"))?.value,
        response: response as unknown as AuthenticationResponseJSON,
      },
      { kind: "sudo", signedIn },
      client,
    );
    jar.delete(cookieName("webauthn"));
    return result.status === "sudo" ? ok(null) : fail("The passkey could not be verified. Try again.");
  },
);
