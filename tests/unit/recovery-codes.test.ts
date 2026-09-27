import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearEnvCache } from "@/server/env";
import {
  findRecoveryCode,
  generateRecoveryCodes,
  looksLikeRecoveryCode,
  normalizeRecoveryCode,
  storedRecoveryCodes,
} from "@/server/security/recovery-codes";
import { TEST_ENV_SOURCE, TEST_KEY_1, TEST_KEY_2 } from "../helpers/env";

beforeEach(() => {
  for (const [name, value] of Object.entries(TEST_ENV_SOURCE)) vi.stubEnv(name, value);
  clearEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearEnvCache();
});

describe("recovery codes", () => {
  it("generates ten distinct, readable codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes)
      expect(code).toMatch(/^[2-9a-hjkmnp-z]{5}-[2-9a-hjkmnp-z]{5}-[2-9a-hjkmnp-z]{5}$/);
  });

  it("stores only keyed hashes", () => {
    const [code] = generateRecoveryCodes(1);
    const [stored] = storedRecoveryCodes([code!]);
    expect(stored).toMatchObject({ keyVersion: 1, usedAt: null });
    expect(stored!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored!.hash).not.toContain(normalizeRecoveryCode(code!));
  });

  it("matches however the code is typed, and skips used ones", () => {
    const codes = generateRecoveryCodes(3);
    const stored = storedRecoveryCodes(codes);
    const typed = ` ${codes[1]!.toUpperCase().replaceAll("-", " ")} `;
    expect(looksLikeRecoveryCode(typed)).toBe(true);
    expect(findRecoveryCode(stored, typed)).toBe(1);
    stored[1]!.usedAt = new Date();
    expect(findRecoveryCode(stored, typed)).toBe(-1);
    expect(findRecoveryCode(stored, "aaaaa-aaaaa-aaaaa")).toBe(-1);
    expect(looksLikeRecoveryCode("123456")).toBe(false);
  });

  it("keeps working after a new encryption key is added", () => {
    const codes = generateRecoveryCodes(2);
    const stored = storedRecoveryCodes(codes);
    vi.stubEnv("DATA_ENCRYPTION_KEYS", `1:${TEST_KEY_1},2:${TEST_KEY_2}`);
    clearEnvCache();
    expect(findRecoveryCode(stored, codes[0]!)).toBe(0);
    expect(storedRecoveryCodes(codes)[0]!.keyVersion).toBe(2);
  });
});
