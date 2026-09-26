"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fail, ok, waitMessage, type ActionResult } from "@/lib/action-result";
import { formatTime, plural } from "@/lib/format";
import { formFields } from "@/server/auth/action";
import { cookieName, cookieOptions } from "@/server/auth/cookies";
import { accessAllowed } from "@/server/auth/dal";
import { completeSetup, PENDING_SETUP_MS, passwordStep, secondFactorStep } from "@/server/auth/login";
import { passkeyAssertionOptions, verifyPasskeyAssertion } from "@/server/auth/passkeys";
import { currentClient } from "@/server/auth/request";
import { SESSION_MAX_MS } from "@/server/auth/sessions";
import { getDb } from "@/server/db/client";
import { hasUnsafeKeys } from "@/server/security/nosql";
import { verifyTurnstile } from "@/server/security/turnstile";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";

// Sign-in actions. They run before there is a session, so each one checks Cloudflare Access itself and
// leaves every other decision to server/auth/login.ts.

const DENIED = "Access denied.";

async function startSession(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(cookieName("session"), token, cookieOptions("session", SESSION_MAX_MS / 1000));
  jar.delete(cookieName("pending"));
  jar.delete(cookieName("webauthn"));
}

function lockedMessage(until: Date): string {
  return `Too many failed attempts. Password sign-in is paused until ${formatTime(until)} (Istanbul time). A passkey still works.`;
}

// --- Password ----------------------------------------------------------------------------------------

const passwordSchema = z.object({
  email: z.string().trim().max(254),
  password: z.string().max(1024),
  turnstileToken: z.string().max(4096).optional(),
});

export type PasswordState = { error: string; email: string } | null;

export async function passwordLoginAction(
  _previous: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  if (!(await accessAllowed())) return { error: DENIED, email: "" };
  const parsed = passwordSchema.safeParse(formFields(formData));
  if (!parsed.success || !parsed.data.email || !parsed.data.password) {
    return { error: "Enter your email address and password.", email: parsed.data?.email ?? "" };
  }
  const { email } = parsed.data;
  const client = await currentClient();

  const bot = await verifyTurnstile({ token: parsed.data.turnstileToken, ip: client.ip, action: "login" });
  if (!bot.ok) return { error: "The bot check did not pass. Wait for it to finish and try again.", email };

  const result = await passwordStep(await getDb(), parsed.data, client);
  switch (result.status) {
    case "invalid":
      return { error: "Email or password is incorrect.", email };
    case "locked":
      return { error: lockedMessage(result.until), email };
    case "rate_limited":
      return { error: waitMessage(result.retryAfterSeconds), email };
    case "second_factor":
    case "setup_required": {
      const maxAge = result.status === "setup_required" ? PENDING_SETUP_MS / 1000 : 5 * 60;
      (await cookies()).set(cookieName("pending"), result.pendingToken, cookieOptions("pending", maxAge));
      redirect(result.status === "setup_required" ? "/admin/setup" : "/admin/login/verify");
    }
  }
}

// --- Second factor -----------------------------------------------------------------------------------

const codeSchema = z.object({ code: z.string().trim().min(1).max(64) });

export type CodeState = { error: string; expired?: boolean } | null;

export async function secondFactorAction(_previous: CodeState, formData: FormData): Promise<CodeState> {
  if (!(await accessAllowed())) return { error: DENIED };
  const parsed = codeSchema.safeParse(formFields(formData));
  if (!parsed.success) return { error: "Enter the code from your authenticator app." };

  const jar = await cookies();
  const result = await secondFactorStep(
    await getDb(),
    { pendingToken: jar.get(cookieName("pending"))?.value, code: parsed.data.code },
    await currentClient(),
  );
  switch (result.status) {
    case "ok":
      await startSession(result.sessionToken);
      redirect(result.method === "recovery" ? "/admin/security?recovery=used" : "/admin");
    case "invalid":
      return { error: `That code didn't work. ${plural(result.attemptsLeft, "try", "tries")} left.` };
    case "locked":
      jar.delete(cookieName("pending"));
      return { error: lockedMessage(result.until), expired: true };
    case "rate_limited":
      return { error: waitMessage(result.retryAfterSeconds) };
    case "expired":
      jar.delete(cookieName("pending"));
      return { error: "This sign-in has expired. Start again.", expired: true };
  }
}

// --- First sign-in: authenticator setup ------------------------------------------------------------------

export type SetupState =
  { error: string; expired?: boolean; recoveryCodes?: never } | { recoveryCodes: string[] } | null;

export async function setupAction(_previous: SetupState, formData: FormData): Promise<SetupState> {
  if (!(await accessAllowed())) return { error: DENIED };
  const parsed = codeSchema.safeParse(formFields(formData));
  if (!parsed.success) return { error: "Enter the 6-digit code your app shows." };

  const jar = await cookies();
  const result = await completeSetup(
    await getDb(),
    { pendingToken: jar.get(cookieName("pending"))?.value, code: parsed.data.code },
    await currentClient(),
  );
  switch (result.status) {
    case "ok":
      await startSession(result.sessionToken);
      return { recoveryCodes: result.recoveryCodes };
    case "invalid":
      return {
        error: `That code didn't match. Check the time on your phone. ${plural(result.attemptsLeft, "try", "tries")} left.`,
      };
    case "rate_limited":
      return { error: waitMessage(result.retryAfterSeconds) };
    case "expired":
      jar.delete(cookieName("pending"));
      return { error: "This setup has expired. Sign in again to restart it.", expired: true };
  }
}

// --- Passkey -------------------------------------------------------------------------------------------

export async function passkeyLoginOptionsAction(): Promise<
  ActionResult<PublicKeyCredentialRequestOptionsJSON>
> {
  if (!(await accessAllowed())) return fail(DENIED, "unauthorized");
  const result = await passkeyAssertionOptions(await getDb(), { kind: "login" }, await currentClient());
  if (result.status === "rate_limited") return fail(waitMessage(result.retryAfterSeconds), "rate_limited");
  (await cookies()).set(cookieName("webauthn"), result.token, cookieOptions("webauthn", 5 * 60));
  return ok(result.options);
}

const assertionSchema = z.looseObject({
  id: z.string().min(1).max(1024),
  rawId: z.string().min(1).max(1024),
  type: z.literal("public-key"),
  response: z.looseObject({
    clientDataJSON: z.string().max(10_000),
    authenticatorData: z.string().max(10_000),
    signature: z.string().max(10_000),
  }),
});

export async function passkeyLoginAction(response: unknown): Promise<ActionResult<null>> {
  if (!(await accessAllowed())) return fail(DENIED, "unauthorized");
  if (hasUnsafeKeys(response) || !assertionSchema.safeParse(response).success) {
    return fail("The passkey response was not understood.", "invalid");
  }
  const jar = await cookies();
  const result = await verifyPasskeyAssertion(
    await getDb(),
    { token: jar.get(cookieName("webauthn"))?.value, response: response as AuthenticationResponseJSON },
    { kind: "login" },
    await currentClient(),
  );
  jar.delete(cookieName("webauthn"));
  if (result.status === "signed_in") {
    await startSession(result.sessionToken);
    return ok(null);
  }
  return fail(
    result.status === "expired"
      ? "The passkey request expired. Try again."
      : "This passkey is not registered here, or it could not be verified.",
  );
}
