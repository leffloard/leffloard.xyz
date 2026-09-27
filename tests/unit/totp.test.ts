import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode } from "@/lib/base32";
import { hotp, otpauthUri, totpCode, totpStep, verifyTotp } from "@/lib/totp";

// RFC 6238 appendix B (SHA-1 key "12345678901234567890", 8 digits).
const RFC_KEY = new TextEncoder().encode("12345678901234567890");
const RFC_VECTORS: [number, string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("base32", () => {
  it("round-trips and matches RFC 4648 vectors", () => {
    const vectors: [string, string][] = [
      ["", ""],
      ["f", "MY"],
      ["fo", "MZXQ"],
      ["foo", "MZXW6"],
      ["foob", "MZXW6YQ"],
      ["fooba", "MZXW6YTB"],
      ["foobar", "MZXW6YTBOI"],
    ];
    for (const [plain, encoded] of vectors) {
      expect(base32Encode(new TextEncoder().encode(plain))).toBe(encoded);
      expect(new TextDecoder().decode(base32Decode(encoded))).toBe(plain);
    }
  });

  it("accepts lower case, spaces and padding, and rejects other characters", () => {
    expect(new TextDecoder().decode(base32Decode("mzxw 6ytb oi======"))).toBe("foobar");
    expect(() => base32Decode("MZXW1")).toThrow("Invalid base32 character.");
  });
});

describe("TOTP", () => {
  it("matches the RFC 6238 test vectors", () => {
    for (const [seconds, code] of RFC_VECTORS) {
      expect(hotp(RFC_KEY, totpStep(new Date(seconds * 1000)), 8)).toBe(code);
    }
  });

  it("accepts the current step and one step of clock drift either way", () => {
    const secret = base32Encode(RFC_KEY);
    const at = new Date(1_700_000_000_000);
    const step = totpStep(at);
    expect(verifyTotp(secret, totpCode(secret, at), at)).toBe(step);
    expect(verifyTotp(secret, totpCode(secret, new Date(at.getTime() - 30_000)), at)).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, new Date(at.getTime() + 30_000)), at)).toBe(step + 1);
    expect(verifyTotp(secret, totpCode(secret, new Date(at.getTime() - 90_000)), at)).toBeNull();
  });

  it("never accepts a step twice", () => {
    const secret = base32Encode(RFC_KEY);
    const at = new Date(1_700_000_000_000);
    const code = totpCode(secret, at);
    const step = verifyTotp(secret, code, at);
    expect(step).not.toBeNull();
    expect(verifyTotp(secret, code, at, { lastUsedStep: step })).toBeNull();
    const next = new Date(at.getTime() + 30_000);
    expect(verifyTotp(secret, totpCode(secret, next), next, { lastUsedStep: step })).toBe(step! + 1);
  });

  it("rejects malformed codes", () => {
    const secret = base32Encode(RFC_KEY);
    const at = new Date(1_700_000_000_000);
    for (const code of ["", "12345", "1234567", "12345a", "ABCDEF"]) {
      expect(verifyTotp(secret, code, at)).toBeNull();
    }
    const spaced = totpCode(secret, at).replace(/^(\d{3})/, "$1 ");
    expect(verifyTotp(secret, spaced, at)).not.toBeNull();
  });

  it("builds the otpauth:// link authenticator apps scan", () => {
    expect(
      otpauthUri({ secret: "JBSWY3DPEHPK3PXP", account: "owner@example.com", issuer: "leffloard.xyz" }),
    ).toBe(
      "otpauth://totp/leffloard.xyz%3Aowner%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=leffloard.xyz&algorithm=SHA1&digits=6&period=30",
    );
  });
});
