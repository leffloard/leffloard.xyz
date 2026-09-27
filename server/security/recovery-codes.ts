import "server-only";
import { createHmac, randomInt } from "node:crypto";
import { safeEqual } from "@/server/security/crypto";
import { derivedKey } from "@/server/security/encryption";

// Ten single-use codes like "k7dq2-m9xhp-4tzr" (about 74 bits each). Stored only as keyed hashes, so a
// database copy alone is not enough to use or brute-force them.
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"; // no 0/o, 1/l/i
const GROUPS = [5, 5, 5];
export const RECOVERY_CODE_COUNT = 10;
const PURPOSE = "recovery-codes";

export type StoredRecoveryCode = { hash: string; keyVersion: number; usedAt: Date | null };

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () =>
    GROUPS.map((size) =>
      Array.from({ length: size }, () => ALPHABET[randomInt(ALPHABET.length)]).join(""),
    ).join("-"),
  );
}

export function normalizeRecoveryCode(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function looksLikeRecoveryCode(input: string): boolean {
  return normalizeRecoveryCode(input).length === GROUPS.reduce((sum, size) => sum + size, 0);
}

export function hashRecoveryCode(code: string, keyVersion?: number): { hash: string; keyVersion: number } {
  const { version, key } = derivedKey(PURPOSE, keyVersion);
  return {
    hash: createHmac("sha256", key).update(normalizeRecoveryCode(code)).digest("hex"),
    keyVersion: version,
  };
}

export function storedRecoveryCodes(codes: string[]): StoredRecoveryCode[] {
  return codes.map((code) => ({ ...hashRecoveryCode(code), usedAt: null }));
}

// Index of the unused stored code matching `input`, or -1. Every entry is compared.
export function findRecoveryCode(stored: StoredRecoveryCode[], input: string): number {
  let found = -1;
  stored.forEach((entry, index) => {
    const same = safeEqual(entry.hash, hashRecoveryCode(input, entry.keyVersion).hash);
    if (same && entry.usedAt === null && found === -1) found = index;
  });
  return found;
}
