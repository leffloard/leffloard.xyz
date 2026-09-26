"use server";

import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { refresh } from "next/cache";
import { z } from "zod";
import { fail, ok } from "@/lib/action-result";
import { plural } from "@/lib/format";
import { adminAction } from "@/server/auth/action";
import { audit } from "@/server/auth/audit";
import {
  changePassword,
  finishAuthenticatorReplacement,
  regenerateRecoveryCodes,
  startAuthenticatorReplacement,
} from "@/server/auth/login";
import {
  passkeyRegistrationOptions,
  registerPasskey,
  removePasskey,
  renamePasskey,
} from "@/server/auth/passkeys";
import { revokeOtherSessions, revokeSession } from "@/server/auth/sessions";
import { clearLoginFailures } from "@/server/security/lockout";

const sessionId = z.string().regex(/^[0-9a-f]{64}$/, "Unknown session.");
const passkeyId = z.string().min(1).max(1024);

// --- Sessions ------------------------------------------------------------------------------------------

export const revokeSessionAction = adminAction(z.object({ id: sessionId }), async ({ id }, context) => {
  if (id === context.session._id) return fail("To end this session, use Sign out.");
  if (!(await revokeSession(context.db, context.user._id, id)))
    return fail("That session has already ended.");
  await audit(context.db, {
    action: "auth.session.revoked",
    actorId: context.user._id,
    ip: context.client.ip,
    userAgent: context.client.userAgent,
  });
  refresh();
  return ok(null, "The session was signed out.");
});

export const revokeOtherSessionsAction = adminAction(z.object({}), async (_input, context) => {
  const count = await revokeOtherSessions(context.db, context.user._id, context.session._id);
  if (count > 0) {
    await audit(context.db, {
      action: "auth.session.revoked",
      actorId: context.user._id,
      ip: context.client.ip,
      userAgent: context.client.userAgent,
      details: { count },
    });
  }
  refresh();
  return ok(null, count ? `${plural(count, "session")} signed out.` : "There were no other sessions.");
});

// --- Password ------------------------------------------------------------------------------------------

export const changePasswordAction = adminAction(
  z
    .object({
      current: z.string().min(1, "Enter your current password.").max(1024),
      next: z.string().max(1024),
      confirm: z.string().max(1024),
    })
    .refine((input) => input.next === input.confirm, {
      path: ["confirm"],
      message: "The passwords do not match.",
    }),
  async (input, context) => {
    const result = await changePassword(context.db, input, context.signedIn, context.client);
    if (result.status === "invalid")
      return { ok: false, error: result.problem, code: "invalid", fieldErrors: {} };
    refresh();
    return ok(
      null,
      result.signedOut
        ? `Password changed. ${plural(result.signedOut, "other session")} signed out.`
        : "Password changed.",
    );
  },
  { sudo: true },
);

// --- Authenticator app and recovery codes --------------------------------------------------------------

export const regenerateRecoveryCodesAction = adminAction(
  z.object({}),
  async (_input, context) => {
    const codes = await regenerateRecoveryCodes(context.db, context.signedIn, context.client);
    refresh();
    return ok(codes);
  },
  { sudo: true },
);

export const startAuthenticatorReplacementAction = adminAction(
  z.object({}),
  async (_input, context) => {
    const { token, qrCode, secret } = await startAuthenticatorReplacement(context.db, context.signedIn);
    return ok({ token, qrCode, secret });
  },
  { sudo: true },
);

export const finishAuthenticatorReplacementAction = adminAction(
  z.object({ token: z.string().min(1).max(100), code: z.string().trim().min(1, "Enter the code.").max(16) }),
  async (input, context) => {
    const result = await finishAuthenticatorReplacement(context.db, input, context.signedIn, context.client);
    if (result.status === "invalid") {
      return fail(`That code didn't match. ${plural(result.attemptsLeft, "try", "tries")} left.`, "invalid");
    }
    if (result.status === "expired") return fail("This change has expired. Start again.");
    refresh();
    return ok(null, "The new authenticator app is active. The old one no longer works.");
  },
  { sudo: true },
);

// --- Passkeys ------------------------------------------------------------------------------------------

export const passkeyRegistrationOptionsAction = adminAction(
  z.object({}),
  async (_input, context) => ok(await passkeyRegistrationOptions(context.db, context.signedIn)),
  { sudo: true },
);

const registration = z.looseObject({
  id: z.string().min(1).max(1024),
  rawId: z.string().min(1).max(1024),
  type: z.literal("public-key"),
  response: z.looseObject({
    clientDataJSON: z.string().max(20_000),
    attestationObject: z.string().max(100_000),
  }),
});

export const registerPasskeyAction = adminAction(
  z.object({ token: z.string().min(1).max(100), response: registration }),
  async (input, context) => {
    const result = await registerPasskey(
      context.db,
      { token: input.token, response: input.response as unknown as RegistrationResponseJSON },
      context.signedIn,
      context.client,
    );
    if (result.status === "too_many") return fail("Remove a passkey before adding another (limit: 10).");
    if (result.status !== "ok") return fail("The passkey could not be added. Try again.");
    refresh();
    return ok(null, `Passkey added: ${result.name}.`);
  },
  { sudo: true },
);

export const renamePasskeyAction = adminAction(
  z.object({ id: passkeyId, name: z.string().trim().min(1, "Enter a name.").max(60) }),
  async ({ id, name }, context) => {
    if (!(await renamePasskey(context.db, context.signedIn, id, name, context.client)))
      return fail("Passkey not found.");
    refresh();
    return ok(null, "Passkey renamed.");
  },
);

export const removePasskeyAction = adminAction(
  z.object({ id: passkeyId }),
  async ({ id }, context) => {
    if (!(await removePasskey(context.db, context.signedIn, id, context.client)))
      return fail("Passkey not found.");
    refresh();
    return ok(null, "Passkey removed.");
  },
  { sudo: true },
);

// --- Lockout -------------------------------------------------------------------------------------------

export const clearLockoutAction = adminAction(z.object({}), async (_input, context) => {
  await clearLoginFailures(context.db, context.user.email);
  await audit(context.db, {
    action: "auth.lockout.cleared",
    actorId: context.user._id,
    ip: context.client.ip,
    userAgent: context.client.userAgent,
  });
  refresh();
  return ok(null, "Password sign-in is open again.");
});
