import "server-only";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { Binary, type Db, type ObjectId } from "mongodb";
import { audit } from "@/server/auth/audit";
import type { Client, SignedIn } from "@/server/auth/login";
import { createSession, grantSudo } from "@/server/auth/sessions";
import { consumeAuthToken, createAuthToken } from "@/server/auth/tokens";
import { describeDevice } from "@/server/auth/devices";
import type { PasskeyDoc } from "@/server/auth/types";
import { findUserById } from "@/server/auth/users";
import { now } from "@/server/clock";
import { getEnv } from "@/server/env";
import { log } from "@/server/log";
import { hitRateLimit, type RateLimit } from "@/server/security/rate-limit";

// Passkeys (WebAuthn): Windows Hello, Touch ID, a phone or a security key. A passkey that verified the user
// (PIN or biometrics) counts as both factors. Passkey sign-in skips the password lockout, so an attacker
// guessing passwords cannot keep the owner out.

export const PASSKEY_LIMIT: RateLimit = { limit: 30, windowMs: 15 * 60_000 };
const CHALLENGE_MS = 5 * 60_000;
const MAX_PASSKEYS = 10;

export function passkeys(db: Db) {
  return db.collection<PasskeyDoc>("passkeys");
}

export function relyingParty(): { id: string; origin: string; name: string } {
  const url = new URL(getEnv().SITE_URL);
  return { id: url.hostname, origin: url.origin, name: "leffloard.xyz admin" };
}

export async function listPasskeys(db: Db, userId: ObjectId): Promise<PasskeyDoc[]> {
  return passkeys(db).find({ userId }).sort({ createdAt: 1 }).toArray();
}

// --- Registration (signed in, after "confirm it's you") -----------------------------------------------

export async function passkeyRegistrationOptions(
  db: Db,
  { user, sessionId }: SignedIn,
): Promise<{ token: string; options: PublicKeyCredentialCreationOptionsJSON }> {
  const rp = relyingParty();
  const existing = await listPasskeys(db, user._id);
  const options = await generateRegistrationOptions({
    rpName: rp.name,
    rpID: rp.id,
    userName: user.email,
    userDisplayName: user.name,
    userID: new Uint8Array(user._id.id),
    attestationType: "none",
    excludeCredentials: existing.map((passkey) => ({ id: passkey._id, transports: passkey.transports })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  const { token } = await createAuthToken(db, {
    purpose: "webauthn-register",
    ttlMs: CHALLENGE_MS,
    userId: user._id,
    sessionId,
    data: { challenge: options.challenge },
  });
  return { token, options };
}

export type RegisterPasskeyResult =
  { status: "ok"; id: string; name: string } | { status: "invalid" | "expired" | "too_many" };

export async function registerPasskey(
  db: Db,
  input: { token: string; response: RegistrationResponseJSON },
  { user, sessionId }: SignedIn,
  client: Client,
): Promise<RegisterPasskeyResult> {
  const pending = await consumeAuthToken(db, input.token, "webauthn-register");
  if (!pending?.data.challenge || pending.sessionId !== sessionId || !pending.userId?.equals(user._id)) {
    return { status: "expired" };
  }
  if ((await passkeys(db).countDocuments({ userId: user._id })) >= MAX_PASSKEYS)
    return { status: "too_many" };

  const rp = relyingParty();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: pending.data.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: true,
    });
  } catch (error) {
    log.info({ err: error }, "passkey registration rejected");
    return { status: "invalid" };
  }
  if (!verification.verified) return { status: "invalid" };

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const name = describeDevice(client.userAgent);
  const doc: PasskeyDoc = {
    _id: credential.id,
    userId: user._id,
    publicKey: new Binary(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? [],
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    name,
    createdAt: now(),
    lastUsedAt: null,
  };
  try {
    await passkeys(db).insertOne(doc);
  } catch {
    return { status: "invalid" }; // the same credential registered twice
  }
  await audit(db, {
    action: "auth.passkey.added",
    actorId: user._id,
    ip: client.ip,
    userAgent: client.userAgent,
    details: { name, backedUp: credentialBackedUp },
  });
  return { status: "ok", id: doc._id, name };
}

export async function renamePasskey(db: Db, { user }: SignedIn, id: string, name: string, client: Client) {
  const result = await passkeys(db).updateOne({ _id: id, userId: user._id }, { $set: { name } });
  if (result.matchedCount === 1) {
    await audit(db, {
      action: "auth.passkey.renamed",
      actorId: user._id,
      ip: client.ip,
      userAgent: client.userAgent,
    });
  }
  return result.matchedCount === 1;
}

export async function removePasskey(db: Db, { user }: SignedIn, id: string, client: Client) {
  const removed = await passkeys(db).findOneAndDelete({ _id: id, userId: user._id });
  if (removed) {
    await audit(db, {
      action: "auth.passkey.removed",
      actorId: user._id,
      ip: client.ip,
      userAgent: client.userAgent,
      details: { name: removed.name },
    });
  }
  return removed !== null;
}

// --- Assertions: sign-in and "confirm it's you" --------------------------------------------------------

type AssertionPurpose = { kind: "login" } | { kind: "sudo"; signedIn: SignedIn };

export type PasskeyOptionsResult =
  | { status: "ok"; token: string; options: PublicKeyCredentialRequestOptionsJSON }
  | { status: "rate_limited"; retryAfterSeconds: number };

export async function passkeyAssertionOptions(
  db: Db,
  purpose: AssertionPurpose,
  client: Client,
): Promise<PasskeyOptionsResult> {
  const limit = await hitRateLimit(db, `passkey:ip:${client.ipKey}`, PASSKEY_LIMIT);
  if (!limit.allowed) return { status: "rate_limited", retryAfterSeconds: limit.retryAfterSeconds };

  const allowCredentials =
    purpose.kind === "sudo"
      ? (await listPasskeys(db, purpose.signedIn.user._id)).map((passkey) => ({
          id: passkey._id,
          transports: passkey.transports,
        }))
      : undefined;
  const options = await generateAuthenticationOptions({
    rpID: relyingParty().id,
    userVerification: "required",
    allowCredentials,
  });
  const { token } = await createAuthToken(db, {
    purpose: "webauthn-login",
    ttlMs: CHALLENGE_MS,
    userId: purpose.kind === "sudo" ? purpose.signedIn.user._id : null,
    sessionId: purpose.kind === "sudo" ? purpose.signedIn.sessionId : null,
    data: { challenge: options.challenge },
  });
  return { status: "ok", token, options };
}

export type PasskeyAssertionResult =
  | { status: "signed_in"; sessionToken: string }
  | { status: "sudo"; until: Date }
  | { status: "invalid" | "expired" };

export async function verifyPasskeyAssertion(
  db: Db,
  input: { token: string | undefined; response: AuthenticationResponseJSON },
  purpose: AssertionPurpose,
  client: Client,
): Promise<PasskeyAssertionResult> {
  // Single use: the challenge is removed before anything else happens.
  const pending = await consumeAuthToken(db, input.token, "webauthn-login");
  if (!pending?.data.challenge) return { status: "expired" };
  if (purpose.kind === "sudo" && pending.sessionId !== purpose.signedIn.sessionId)
    return { status: "expired" };

  const passkey = await passkeys(db).findOne({ _id: input.response.id });
  const owner = passkey ? await findUserById(db, passkey.userId) : null;
  const fail = async (reason: string): Promise<PasskeyAssertionResult> => {
    await audit(db, {
      action: "auth.passkey.failed",
      actorId: owner?._id ?? null,
      ip: client.ip,
      userAgent: client.userAgent,
      details: { reason, purpose: purpose.kind },
    });
    return { status: "invalid" };
  };
  if (!passkey || !owner) return fail("unknown-credential");
  if (purpose.kind === "sudo" && !owner._id.equals(purpose.signedIn.user._id)) return fail("other-user");

  const rp = relyingParty();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: pending.data.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: {
        id: passkey._id,
        publicKey: new Uint8Array(passkey.publicKey.value()),
        counter: passkey.counter,
        transports: passkey.transports,
      },
      requireUserVerification: true,
    });
  } catch {
    return fail("verification-error");
  }
  if (!verification.verified) return fail("not-verified");

  // A counter that does not move forward would mean a cloned authenticator (most passkeys report 0).
  const { newCounter } = verification.authenticationInfo;
  const updated = await passkeys(db).updateOne(
    { _id: passkey._id, counter: passkey.counter },
    {
      $set: {
        counter: newCounter,
        lastUsedAt: now(),
        backedUp: verification.authenticationInfo.credentialBackedUp,
      },
    },
  );
  if (updated.matchedCount !== 1) return fail("counter-race");

  if (purpose.kind === "sudo") {
    const until = await grantSudo(db, purpose.signedIn.sessionId);
    await audit(db, {
      action: "auth.sudo.confirmed",
      actorId: owner._id,
      ip: client.ip,
      userAgent: client.userAgent,
      details: { method: "passkey" },
    });
    return { status: "sudo", until };
  }

  const { token } = await createSession(db, {
    userId: owner._id,
    ip: client.ip,
    userAgent: client.userAgent,
    methods: ["passkey"],
  });
  await audit(db, {
    action: "auth.login.succeeded",
    actorId: owner._id,
    ip: client.ip,
    userAgent: client.userAgent,
    details: { methods: "passkey", passkey: passkey.name },
  });
  return { status: "signed_in", sessionToken: token };
}
