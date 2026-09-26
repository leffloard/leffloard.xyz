import { describe, expect, it } from "vitest";
import type { KeyRing } from "@/server/env";
import {
  DecryptionError,
  decryptSecret,
  derivedKey,
  encryptSecret,
  usesOldKey,
} from "@/server/security/encryption";

const KEY_1 = Buffer.alloc(32, 1);
const KEY_2 = Buffer.alloc(32, 2);
const ringV1: KeyRing = { current: 1, keys: new Map([[1, KEY_1]]) };
const ringV2: KeyRing = {
  current: 2,
  keys: new Map([
    [1, KEY_1],
    [2, KEY_2],
  ]),
};

describe("encryptSecret / decryptSecret", () => {
  it("round-trips and never produces the same ciphertext twice", () => {
    const a = encryptSecret("JBSWY3DPEHPK3PXP", "totp:1", ringV1);
    const b = encryptSecret("JBSWY3DPEHPK3PXP", "totp:1", ringV1);
    expect(a).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(a, "totp:1", ringV1)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("binds the value to its context", () => {
    const stored = encryptSecret("secret", "totp:user-a", ringV1);
    expect(() => decryptSecret(stored, "totp:user-b", ringV1)).toThrow(DecryptionError);
  });

  it("detects tampering", () => {
    const stored = encryptSecret("secret", "ctx", ringV1);
    const parts = stored.split(".");
    const data = Buffer.from(parts[3]!, "base64url");
    data[0]! ^= 1;
    parts[3] = data.toString("base64url");
    expect(() => decryptSecret(parts.join("."), "ctx", ringV1)).toThrow(DecryptionError);
    expect(() => decryptSecret("not-encrypted", "ctx", ringV1)).toThrow("not in the expected format");
  });

  it("keeps old values readable after a new key is added, and flags them for re-encryption", () => {
    const old = encryptSecret("secret", "ctx", ringV1);
    expect(decryptSecret(old, "ctx", ringV2)).toBe("secret");
    expect(usesOldKey(old, ringV2)).toBe(true);
    const fresh = encryptSecret("secret", "ctx", ringV2);
    expect(fresh.startsWith("v2.")).toBe(true);
    expect(usesOldKey(fresh, ringV2)).toBe(false);
  });

  it("names a missing key instead of failing obscurely", () => {
    const fresh = encryptSecret("secret", "ctx", ringV2);
    expect(() => decryptSecret(fresh, "ctx", ringV1)).toThrow(
      "Encryption key number 2 is not in DATA_ENCRYPTION_KEYS.",
    );
  });
});

describe("derivedKey", () => {
  it("gives each purpose and key number its own key", () => {
    const a = derivedKey("recovery-codes", undefined, ringV2);
    const b = derivedKey("other", undefined, ringV2);
    const old = derivedKey("recovery-codes", 1, ringV2);
    expect(a.version).toBe(2);
    expect(a.key).toHaveLength(32);
    expect(a.key.equals(b.key)).toBe(false);
    expect(a.key.equals(old.key)).toBe(false);
    expect(a.key.equals(derivedKey("recovery-codes", 2, ringV2).key)).toBe(true);
  });
});
