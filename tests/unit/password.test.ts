import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, passwordProblem, verifyPassword } from "@/server/security/password";

describe("hashPassword / verifyPassword", () => {
  it("uses argon2id and verifies only the right password", async () => {
    const stored = await hashPassword("a long enough passphrase");
    expect(stored).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    await expect(verifyPassword(stored, "a long enough passphrase")).resolves.toBe(true);
    await expect(verifyPassword(stored, "a long enough passphrasE")).resolves.toBe(false);
    expect(needsRehash(stored)).toBe(false);
  });

  it("does the same work for unknown accounts and never throws on garbage", async () => {
    await expect(verifyPassword(null, "whatever it is")).resolves.toBe(false);
    await expect(verifyPassword("not-a-hash", "whatever it is")).resolves.toBe(false);
  });

  it("refuses over-long input without hashing it", async () => {
    const stored = await hashPassword("a long enough passphrase");
    await expect(verifyPassword(stored, "x".repeat(10_000))).resolves.toBe(false);
  });

  it("asks for a rehash of weaker or foreign hashes", () => {
    expect(needsRehash("$argon2id$v=19$m=4096,t=1,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaA")).toBe(true);
    expect(needsRehash("$2b$12$abcdefghijklmnopqrstuuJ2bJ8S7lQ9m0wW3E8zXo5fY1Vq6Z1rG")).toBe(true);
  });
});

describe("passwordProblem", () => {
  it.each([
    ["short", "Use at least 12 characters."],
    ["x".repeat(257), "Use at most 256 characters."],
    ["aaaaaaaaaaaaaa", "Use more than one repeated character."],
    ["Password1234", "This password is too common."],
    ["mert.koparan-2026!", "Do not use your email address."],
  ])("rejects %j", (password, problem) => {
    expect(passwordProblem(password, "mert.koparan@example.com")).toBe(problem);
  });

  it("accepts a reasonable passphrase", () => {
    expect(passwordProblem("purple kettle on the balcony", "a@example.com")).toBeNull();
  });
});
