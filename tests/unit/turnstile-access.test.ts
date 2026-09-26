import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearEnvCache } from "@/server/env";
import { verifyCloudflareAccess } from "@/server/security/cloudflare-access";
import { verifyTurnstile } from "@/server/security/turnstile";
import { TEST_ENV_SOURCE } from "../helpers/env";

function useEnv(extra: Record<string, string>) {
  for (const [name, value] of Object.entries({
    ...TEST_ENV_SOURCE,
    SITE_URL: "https://leffloard.xyz",
    ...extra,
  })) {
    vi.stubEnv(name, value);
  }
  clearEnvCache();
}

afterEach(() => {
  vi.unstubAllEnvs();
  clearEnvCache();
});

function fakeFetch(body: unknown) {
  const calls: URLSearchParams[] = [];
  const impl = (async (_url: string, init?: RequestInit) => {
    calls.push(init?.body as URLSearchParams);
    return new Response(JSON.stringify(body));
  }) as typeof fetch;
  return { impl, calls };
}

describe("verifyTurnstile", () => {
  const LIVE = { TURNSTILE_SITE_KEY: "0x4AAAAAAAsite", TURNSTILE_SECRET_KEY: "0x4AAAAAAAsecret" };

  it("is skipped when Turnstile is not configured", async () => {
    useEnv({});
    await expect(verifyTurnstile({ token: null, ip: "unknown", action: "login" })).resolves.toEqual({
      ok: true,
      skipped: true,
    });
  });

  it("accepts a valid token for this site and action", async () => {
    useEnv(LIVE);
    const { impl, calls } = fakeFetch({ success: true, hostname: "leffloard.xyz", action: "login" });
    await expect(
      verifyTurnstile({ token: "tok", ip: "203.0.113.5", action: "login" }, impl),
    ).resolves.toEqual({
      ok: true,
      skipped: false,
    });
    expect(calls[0]?.get("secret")).toBe("0x4AAAAAAAsecret");
    expect(calls[0]?.get("remoteip")).toBe("203.0.113.5");
    expect(calls[0]?.get("idempotency_key")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    [{ success: false, "error-codes": ["timeout-or-duplicate"] }, "timeout-or-duplicate"],
    [{ success: true, hostname: "evil.example", action: "login" }, "hostname-mismatch"],
    [{ success: true, hostname: "leffloard.xyz", action: "contact" }, "action-mismatch"],
  ])("refuses %j", async (body, reason) => {
    useEnv(LIVE);
    const { impl } = fakeFetch(body);
    await expect(verifyTurnstile({ token: "tok", ip: "unknown", action: "login" }, impl)).resolves.toEqual({
      ok: false,
      reason,
    });
  });

  it("fails closed without a token or when Cloudflare is unreachable", async () => {
    useEnv(LIVE);
    await expect(verifyTurnstile({ token: "", ip: "unknown", action: "login" })).resolves.toMatchObject({
      ok: false,
      reason: "missing-token",
    });
    const failing = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    await expect(verifyTurnstile({ token: "tok", ip: "unknown", action: "login" }, failing)).resolves.toEqual(
      {
        ok: false,
        reason: "unreachable",
      },
    );
  });
});

describe("verifyCloudflareAccess", () => {
  const TEAM = "leff.cloudflareaccess.com";
  const AUD = "a".repeat(64);
  let sign: (claims: { aud?: string; iss?: string; exp?: string }) => Promise<string>;
  let getKey: ReturnType<typeof createLocalJWKSet>;

  beforeEach(async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
    getKey = createLocalJWKSet({ keys: [jwk] });
    sign = (claims) =>
      new SignJWT({ email: "owner@example.com" })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(claims.iss ?? `https://${TEAM}`)
        .setAudience(claims.aud ?? AUD)
        .setIssuedAt()
        .setExpirationTime(claims.exp ?? "5m")
        .sign(privateKey);
  });

  it("is skipped when Access is not configured", async () => {
    useEnv({});
    await expect(verifyCloudflareAccess(new Headers(), getKey)).resolves.toEqual({ ok: true, skipped: true });
  });

  it("accepts a token signed for this application", async () => {
    useEnv({ CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD });
    const headers = new Headers({ "cf-access-jwt-assertion": await sign({}) });
    await expect(verifyCloudflareAccess(headers, getKey)).resolves.toEqual({
      ok: true,
      skipped: false,
      email: "owner@example.com",
    });
  });

  it("refuses missing, foreign, expired and wrong-issuer tokens", async () => {
    useEnv({ CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD });
    await expect(verifyCloudflareAccess(new Headers(), getKey)).resolves.toEqual({
      ok: false,
      reason: "missing-token",
    });
    for (const claims of [
      { aud: "b".repeat(64) },
      { iss: "https://evil.cloudflareaccess.com" },
      { exp: "-1m" },
    ]) {
      const headers = new Headers({ "cf-access-jwt-assertion": await sign(claims) });
      await expect(verifyCloudflareAccess(headers, getKey)).resolves.toEqual({
        ok: false,
        reason: "invalid-token",
      });
    }
  });
});
