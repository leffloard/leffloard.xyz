import "server-only";
import { hash, parseOptions, verify, type Algorithm } from "@node-rs/argon2";

// argon2id with OWASP's recommended minimum (19 MiB, 2 passes, 1 lane): about 50 ms per check on a VDS.
const ARGON2ID = 2 as Algorithm; // Algorithm.Argon2id (a const enum, which isolatedModules cannot inline)
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

const COMMON = new Set([
  "password1234",
  "123456789012",
  "qwertyuiop12",
  "iloveyou1234",
  "adminadmin12",
  "leffloard123",
  "leffloard.xyz",
  "correcthorsebatterystaple",
]);

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

// Unknown accounts are checked against this hash, so a wrong email takes as long as a wrong password.
let dummyHash: Promise<string> | undefined;

export async function verifyPassword(
  storedHash: string | null | undefined,
  password: string,
): Promise<boolean> {
  if (password.length > PASSWORD_MAX_LENGTH) return false;
  if (!storedHash) {
    dummyHash ??= hashPassword("not-a-real-password-just-equal-timing");
    await verify(await dummyHash, password).catch(() => false);
    return false;
  }
  return verify(storedHash, password).catch(() => false);
}

// True when the hash was made with weaker settings than today's; rehash it after a successful sign-in.
export function needsRehash(storedHash: string): boolean {
  try {
    const current = parseOptions(storedHash);
    return (
      current.algorithm !== ARGON2ID ||
      current.memoryCost < OPTIONS.memoryCost ||
      current.timeCost < OPTIONS.timeCost ||
      current.parallelism !== OPTIONS.parallelism
    );
  } catch {
    return true;
  }
}

// Plain-English reason the password is not acceptable, or null.
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (/^(.)\1+$/.test(password)) return "Use more than one repeated character.";
  const lower = password.toLowerCase().replace(/\s+/g, "");
  if (COMMON.has(lower)) return "This password is too common.";
  const local = email?.toLowerCase().split("@")[0] ?? "";
  if (local.length >= 4 && lower.includes(local)) return "Do not use your email address.";
  return null;
}
