import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { getEnv, type KeyRing } from "@/server/env";

// AES-256-GCM for secrets stored in the database (TOTP secrets, later provider credentials).
// Stored form: "v<key number>.<iv>.<auth tag>.<ciphertext>", base64url parts. The context (for example
// "totp:<user id>") is authenticated but not stored, so a value copied to another record fails to decrypt.

const PREFIX = /^v(\d{1,4})\.([\w-]+)\.([\w-]+)\.([\w-]*)$/;

export class DecryptionError extends Error {
  constructor(message = "The value could not be decrypted.") {
    super(message);
    this.name = "DecryptionError";
  }
}

function keyRing(ring?: KeyRing): KeyRing {
  return ring ?? getEnv().DATA_ENCRYPTION_KEYS;
}

export function encryptSecret(plaintext: string, context: string, ring?: KeyRing): string {
  const { current, keys } = keyRing(ring);
  const key = keys.get(current)!;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const parts = [iv, cipher.getAuthTag(), data].map((part) => part.toString("base64url"));
  return `v${current}.${parts.join(".")}`;
}

export function decryptSecret(stored: string, context: string, ring?: KeyRing): string {
  const match = PREFIX.exec(stored);
  if (!match) throw new DecryptionError("The stored value is not in the expected format.");
  const key = keyRing(ring).keys.get(Number(match[1]));
  if (!key) throw new DecryptionError(`Encryption key number ${match[1]} is not in DATA_ENCRYPTION_KEYS.`);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(match[2]!, "base64url"));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(match[3]!, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(match[4]!, "base64url")), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    throw new DecryptionError();
  }
}

// True when the value was encrypted with an older key and should be re-encrypted.
export function usesOldKey(stored: string, ring?: KeyRing): boolean {
  const version = Number(PREFIX.exec(stored)?.[1]);
  return version !== keyRing(ring).current;
}

// A separate key for each purpose (HMAC of recovery codes, ...), derived from a numbered data key.
export function derivedKey(
  purpose: string,
  version?: number,
  ring?: KeyRing,
): { version: number; key: Buffer } {
  const { current, keys } = keyRing(ring);
  const chosen = version ?? current;
  const base = keys.get(chosen);
  if (!base) throw new DecryptionError(`Encryption key number ${chosen} is not in DATA_ENCRYPTION_KEYS.`);
  return {
    version: chosen,
    key: Buffer.from(hkdfSync("sha256", base, Buffer.alloc(0), `leffloard:${purpose}`, 32)),
  };
}
