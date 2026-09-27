import "server-only";
import { randomBytes } from "node:crypto";
import type { Db, Filter } from "mongodb";
import QRCode from "qrcode";
import { base32Encode } from "@/lib/base32";
import { otpauthUri, verifyTotp } from "@/lib/totp";
import { alertSignInLocked } from "@/server/auth/alerts";
import { audit } from "@/server/auth/audit";
import { createSession, grantSudo, revokeOtherSessions } from "@/server/auth/sessions";
import {
  consumeAuthToken,
  createAuthToken,
  deleteAuthToken,
  findAuthToken,
  recordTokenAttempt,
} from "@/server/auth/tokens";
import type { UserDoc } from "@/server/auth/types";
import { findUserByEmail, findUserById, normalizeEmail, setPassword, users } from "@/server/auth/users";
import { now } from "@/server/clock";
import { decryptSecret, encryptSecret } from "@/server/security/encryption";
import { clearLoginFailures, lockedUntil, recordLoginFailure } from "@/server/security/lockout";
import { hashPassword, needsRehash, passwordProblem, verifyPassword } from "@/server/security/password";
import { hitRateLimit, releaseRateLimit, type RateLimit } from "@/server/security/rate-limit";
import {
  findRecoveryCode,
  generateRecoveryCodes,
  looksLikeRecoveryCode,
  storedRecoveryCodes,
} from "@/server/security/recovery-codes";

// Sign-in: password, then an authenticator code (or a recovery code). The very first sign-in sets up the
// authenticator before any session exists, so the admin is never reachable with a password alone.

export const ISSUER = "leffloard.xyz";
export const LOGIN_LIMIT: RateLimit = { limit: 20, windowMs: 15 * 60_000 };
export const SECOND_FACTOR_LIMIT: RateLimit = { limit: 20, windowMs: 15 * 60_000 };
export const SUDO_LIMIT: RateLimit = { limit: 10, windowMs: 15 * 60_000 };
export const PENDING_SECOND_FACTOR_MS = 5 * 60_000;
export const PENDING_SETUP_MS = 15 * 60_000;

export type Client = { ip: string; ipKey: string; userAgent: string };

type Limited = { status: "rate_limited"; retryAfterSeconds: number };
type Locked = { status: "locked"; until: Date };
type Expired = { status: "expired" };

const totpContext = (user: Pick<UserDoc, "_id">) => `totp:${user._id.toHexString()}`;
const setupContext = (user: Pick<UserDoc, "_id">) => `totp-setup:${user._id.toHexString()}`;

// --- Password ------------------------------------------------------------------------------------------

export type PasswordStepResult =
  | { status: "second_factor"; pendingToken: string }
  | { status: "setup_required"; pendingToken: string }
  | { status: "invalid" }
  | Locked
  | Limited;

export async function passwordStep(
  db: Db,
  input: { email: string; password: string },
  client: Client,
): Promise<PasswordStepResult> {
  const limitKey = `login:ip:${client.ipKey}`;
  const limit = await hitRateLimit(db, limitKey, LOGIN_LIMIT);
  if (!limit.allowed) return { status: "rate_limited", retryAfterSeconds: limit.retryAfterSeconds };

  const email = normalizeEmail(input.email);
  const locked = await lockedUntil(db, email);
  if (locked) return { status: "locked", until: locked };

  const user = await findUserByEmail(db, email);
  const passwordOk = await verifyPassword(user?.passwordHash, input.password);
  if (!user || !passwordOk) {
    const failure = await recordLoginFailure(db, email);
    const actorId = user?._id ?? null;
    await audit(db, {
      action: "auth.login.failed",
      actorId,
      ip: client.ip,
      userAgent: client.userAgent,
      details: { step: "password", failures: failure.failures },
    });
    if (failure.lockedUntil) {
      await audit(db, {
        action: "auth.login.locked",
        actorId,
        ip: client.ip,
        userAgent: client.userAgent,
        details: { failures: failure.failures, until: failure.lockedUntil.toISOString() },
      });
      await alertSignInLocked(
        db,
        { failures: failure.failures, until: failure.lockedUntil, userId: actorId, step: "password" },
        now(),
      );
      return { status: "locked", until: failure.lockedUntil };
    }
    return { status: "invalid" };
  }

  await releaseRateLimit(db, limitKey);
  if (needsRehash(user.passwordHash)) {
    await users(db).updateOne(
      { _id: user._id },
      { $set: { passwordHash: await hashPassword(input.password) } },
    );
  }

  if (user.totp) {
    const { token } = await createAuthToken(db, {
      purpose: "login-2fa",
      ttlMs: PENDING_SECOND_FACTOR_MS,
      userId: user._id,
    });
    return { status: "second_factor", pendingToken: token };
  }

  const secret = base32Encode(randomBytes(20));
  const { token } = await createAuthToken(db, {
    purpose: "setup-2fa",
    ttlMs: PENDING_SETUP_MS,
    userId: user._id,
    data: { secret: encryptSecret(secret, setupContext(user)) },
  });
  return { status: "setup_required", pendingToken: token };
}

// --- Second factor -------------------------------------------------------------------------------------

// Checks an authenticator or recovery code and marks it used. Each code works once, even when two requests
// race: the database update only succeeds for the first.
async function spendSecondFactor(db: Db, user: UserDoc, code: string): Promise<"totp" | "recovery" | null> {
  if (!user.totp) return null;
  if (looksLikeRecoveryCode(code)) {
    const index = findRecoveryCode(user.recoveryCodes, code);
    const entry = user.recoveryCodes[index];
    if (!entry) return null;
    const result = await users(db).updateOne(
      {
        _id: user._id,
        [`recoveryCodes.${index}.hash`]: entry.hash,
        [`recoveryCodes.${index}.usedAt`]: null,
      } as Filter<UserDoc>,
      { $set: { [`recoveryCodes.${index}.usedAt`]: now() } },
    );
    return result.modifiedCount === 1 ? "recovery" : null;
  }
  const secret = decryptSecret(user.totp.secret, totpContext(user));
  const step = verifyTotp(secret, code, now(), { lastUsedStep: user.totp.lastUsedStep });
  if (step === null) return null;
  const result = await users(db).updateOne(
    { _id: user._id, "totp.lastUsedStep": { $lt: step } },
    { $set: { "totp.lastUsedStep": step } },
  );
  return result.modifiedCount === 1 ? "totp" : null;
}

export type SecondFactorResult =
  | { status: "ok"; sessionToken: string; method: "totp" | "recovery"; recoveryCodesLeft: number }
  | { status: "invalid"; attemptsLeft: number }
  | Expired
  | Locked
  | Limited;

export async function secondFactorStep(
  db: Db,
  input: { pendingToken: string | undefined; code: string },
  client: Client,
): Promise<SecondFactorResult> {
  const limit = await hitRateLimit(db, `2fa:ip:${client.ipKey}`, SECOND_FACTOR_LIMIT);
  if (!limit.allowed) return { status: "rate_limited", retryAfterSeconds: limit.retryAfterSeconds };

  const pending = await findAuthToken(db, input.pendingToken, "login-2fa");
  const user = pending?.userId ? await findUserById(db, pending.userId) : null;
  if (!pending || !user?.totp) return { status: "expired" };
  const locked = await lockedUntil(db, user.email);
  if (locked) return { status: "locked", until: locked };

  const method = await spendSecondFactor(db, user, input.code);
  if (!method) {
    const attemptsLeft = await recordTokenAttempt(db, pending._id);
    const failure = await recordLoginFailure(db, user.email);
    await audit(db, {
      action: "auth.second_factor.failed",
      actorId: user._id,
      ip: client.ip,
      userAgent: client.userAgent,
      details: { attemptsLeft },
    });
    if (failure.lockedUntil) {
      await deleteAuthToken(db, pending._id);
      await audit(db, {
        action: "auth.login.locked",
        actorId: user._id,
        ip: client.ip,
        userAgent: client.userAgent,
        details: { failures: failure.failures, until: failure.lockedUntil.toISOString() },
      });
      await alertSignInLocked(
        db,
        { failures: failure.failures, until: failure.lockedUntil, userId: user._id, step: "code" },
        now(),
      );
      return { status: "locked", until: failure.lockedUntil };
    }
    return attemptsLeft > 0 ? { status: "invalid", attemptsLeft } : { status: "expired" };
  }

  if (!(await consumeAuthToken(db, input.pendingToken, "login-2fa"))) return { status: "expired" };
  await clearLoginFailures(db, user.email);
  const { token } = await createSession(db, {
    userId: user._id,
    ip: client.ip,
    userAgent: client.userAgent,
    methods: ["password", method],
  });
  const recoveryCodesLeft =
    user.recoveryCodes.filter((entry) => entry.usedAt === null).length - (method === "recovery" ? 1 : 0);
  if (method === "recovery") {
    await audit(db, {
      action: "auth.recovery_code.used",
      actorId: user._id,
      ip: client.ip,
      userAgent: client.userAgent,
      details: { left: recoveryCodesLeft },
    });
  }
  await audit(db, {
    action: "auth.login.succeeded",
    actorId: user._id,
    ip: client.ip,
    userAgent: client.userAgent,
    details: { methods: `password+${method}` },
  });
  return { status: "ok", sessionToken: token, method, recoveryCodesLeft };
}

// --- Authenticator setup -------------------------------------------------------------------------------

export type AuthenticatorSetup = { secret: string; uri: string; qrCode: string; email: string };

async function describeSecret(secret: string, email: string): Promise<AuthenticatorSetup> {
  const uri = otpauthUri({ secret, account: email, issuer: ISSUER });
  const svg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { secret, uri, email, qrCode: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` };
}

export async function pendingSetup(
  db: Db,
  pendingToken: string | undefined,
): Promise<AuthenticatorSetup | null> {
  const pending = await findAuthToken(db, pendingToken, "setup-2fa");
  const user = pending?.userId ? await findUserById(db, pending.userId) : null;
  if (!pending?.data.secret || !user || user.totp) return null;
  return describeSecret(decryptSecret(pending.data.secret, setupContext(user)), user.email);
}

export type CompleteSetupResult =
  | { status: "ok"; sessionToken: string; recoveryCodes: string[] }
  | { status: "invalid"; attemptsLeft: number }
  | Expired
  | Limited;

export async function completeSetup(
  db: Db,
  input: { pendingToken: string | undefined; code: string },
  client: Client,
): Promise<CompleteSetupResult> {
  const limit = await hitRateLimit(db, `2fa:ip:${client.ipKey}`, SECOND_FACTOR_LIMIT);
  if (!limit.allowed) return { status: "rate_limited", retryAfterSeconds: limit.retryAfterSeconds };

  const pending = await findAuthToken(db, input.pendingToken, "setup-2fa");
  const user = pending?.userId ? await findUserById(db, pending.userId) : null;
  if (!pending?.data.secret || !user || user.totp) return { status: "expired" };

  const secret = decryptSecret(pending.data.secret, setupContext(user));
  const step = verifyTotp(secret, input.code, now());
  if (step === null) {
    const attemptsLeft = await recordTokenAttempt(db, pending._id);
    return attemptsLeft > 0 ? { status: "invalid", attemptsLeft } : { status: "expired" };
  }
  if (!(await consumeAuthToken(db, input.pendingToken, "setup-2fa"))) return { status: "expired" };

  const recoveryCodes = generateRecoveryCodes();
  const at = now();
  const result = await users(db).updateOne(
    { _id: user._id, totp: null },
    {
      $set: {
        totp: { secret: encryptSecret(secret, totpContext(user)), enabledAt: at, lastUsedStep: step },
        recoveryCodes: storedRecoveryCodes(recoveryCodes),
        updatedAt: at,
      },
    },
  );
  if (result.modifiedCount !== 1) return { status: "expired" };

  await clearLoginFailures(db, user.email);
  const { token } = await createSession(db, {
    userId: user._id,
    ip: client.ip,
    userAgent: client.userAgent,
    methods: ["password", "totp"],
  });
  for (const action of [
    "auth.totp.enabled",
    "auth.recovery_codes.generated",
    "auth.login.succeeded",
  ] as const) {
    await audit(db, { action, actorId: user._id, ip: client.ip, userAgent: client.userAgent });
  }
  return { status: "ok", sessionToken: token, recoveryCodes };
}

// --- Signed-in changes -----------------------------------------------------------------------------------

export type SignedIn = { user: UserDoc; sessionId: string };

export type SudoResult = { status: "ok"; until: Date } | { status: "invalid" } | Limited;

// "Confirm it's you": password and a fresh authenticator code, valid for 10 minutes.
export async function confirmSudo(
  db: Db,
  input: { password: string; code: string },
  { user, sessionId }: SignedIn,
  client: Client,
): Promise<SudoResult> {
  const limit = await hitRateLimit(db, `sudo:${sessionId}`, SUDO_LIMIT);
  if (!limit.allowed) return { status: "rate_limited", retryAfterSeconds: limit.retryAfterSeconds };

  const passwordOk = await verifyPassword(user.passwordHash, input.password);
  const method = passwordOk ? await spendSecondFactor(db, user, input.code) : null;
  if (!method) {
    await audit(db, {
      action: "auth.sudo.failed",
      actorId: user._id,
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return { status: "invalid" };
  }
  const until = await grantSudo(db, sessionId);
  await audit(db, {
    action: "auth.sudo.confirmed",
    actorId: user._id,
    ip: client.ip,
    userAgent: client.userAgent,
    details: { method: `password+${method}` },
  });
  return { status: "ok", until };
}

export type ChangePasswordResult =
  { status: "ok"; signedOut: number } | { status: "invalid"; problem: string };

export async function changePassword(
  db: Db,
  input: { current: string; next: string },
  { user, sessionId }: SignedIn,
  client: Client,
): Promise<ChangePasswordResult> {
  if (!(await verifyPassword(user.passwordHash, input.current))) {
    return { status: "invalid", problem: "The current password is not correct." };
  }
  const problem = passwordProblem(input.next, user.email);
  if (problem) return { status: "invalid", problem };
  if (input.next === input.current) return { status: "invalid", problem: "Choose a new password." };

  await setPassword(db, user._id, input.next);
  const signedOut = await revokeOtherSessions(db, user._id, sessionId);
  await audit(db, {
    action: "auth.password.changed",
    actorId: user._id,
    ip: client.ip,
    userAgent: client.userAgent,
    details: { signedOut },
  });
  return { status: "ok", signedOut };
}

export async function regenerateRecoveryCodes(db: Db, { user }: SignedIn, client: Client): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await users(db).updateOne(
    { _id: user._id },
    { $set: { recoveryCodes: storedRecoveryCodes(codes), updatedAt: now() } },
  );
  await audit(db, {
    action: "auth.recovery_codes.generated",
    actorId: user._id,
    ip: client.ip,
    userAgent: client.userAgent,
  });
  return codes;
}

// Replacing the authenticator: a new secret is shown, and only a correct code from it switches over.
export async function startAuthenticatorReplacement(
  db: Db,
  { user, sessionId }: SignedIn,
): Promise<{ token: string } & AuthenticatorSetup> {
  const secret = base32Encode(randomBytes(20));
  const { token } = await createAuthToken(db, {
    purpose: "totp-replace",
    ttlMs: PENDING_SETUP_MS,
    userId: user._id,
    sessionId,
    data: { secret: encryptSecret(secret, setupContext(user)) },
  });
  return { token, ...(await describeSecret(secret, user.email)) };
}

export type ReplaceAuthenticatorResult =
  { status: "ok"; signedOut: number } | { status: "invalid"; attemptsLeft: number } | Expired;

export async function finishAuthenticatorReplacement(
  db: Db,
  input: { token: string; code: string },
  { user, sessionId }: SignedIn,
  client: Client,
): Promise<ReplaceAuthenticatorResult> {
  const pending = await findAuthToken(db, input.token, "totp-replace");
  if (!pending?.data.secret || pending.sessionId !== sessionId || !pending.userId?.equals(user._id)) {
    return { status: "expired" };
  }
  const secret = decryptSecret(pending.data.secret, setupContext(user));
  const step = verifyTotp(secret, input.code, now());
  if (step === null) {
    const attemptsLeft = await recordTokenAttempt(db, pending._id);
    return attemptsLeft > 0 ? { status: "invalid", attemptsLeft } : { status: "expired" };
  }
  if (!(await consumeAuthToken(db, input.token, "totp-replace"))) return { status: "expired" };

  const at = now();
  await users(db).updateOne(
    { _id: user._id },
    {
      $set: {
        totp: { secret: encryptSecret(secret, totpContext(user)), enabledAt: at, lastUsedStep: step },
        updatedAt: at,
      },
    },
  );
  const signedOut = await revokeOtherSessions(db, user._id, sessionId);
  await audit(db, {
    action: "auth.totp.replaced",
    actorId: user._id,
    ip: client.ip,
    userAgent: client.userAgent,
    details: { signedOut },
  });
  return { status: "ok", signedOut };
}
