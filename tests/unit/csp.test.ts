import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, isPrivatePath, usesNonce } from "@/lib/csp";

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split("; ").map((part) => {
      const [name = "", ...values] = part.split(" ");
      return [name, values];
    }),
  );
}

describe("contentSecurityPolicy", () => {
  it("locks dynamic pages to the request nonce in production", () => {
    const policy = directives(contentSecurityPolicy({ nonce: "abc123", dev: false }));
    expect(policy.get("script-src")).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(policy.get("style-src")).toEqual(["'self'", "'nonce-abc123'"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'none'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("form-action")).toEqual(["'self'"]);
    expect(policy.get("frame-src")).toEqual(["https://challenges.cloudflare.com"]);
    expect(policy.has("upgrade-insecure-requests")).toBe(true);
    expect(policy.get("report-uri")).toEqual(["/api/csp-report"]);
  });

  it("never allows inline or eval'd scripts on dynamic production pages", () => {
    const policy = contentSecurityPolicy({ nonce: "abc123", dev: false });
    expect(directives(policy).get("script-src")).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it("relaxes only what development needs", () => {
    const policy = directives(contentSecurityPolicy({ nonce: "abc123", dev: true }));
    expect(policy.get("script-src")).toContain("'unsafe-eval'");
    expect(policy.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy.has("upgrade-insecure-requests")).toBe(false);
  });

  it("gives the prerendered 404 page a policy without a nonce", () => {
    const policy = directives(contentSecurityPolicy({ dev: false }));
    expect(policy.get("script-src")).toEqual([
      "'self'",
      "'unsafe-inline'",
      "https://challenges.cloudflare.com",
    ]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
  });
});

describe("isPrivatePath", () => {
  it.each([
    ["/admin", true],
    ["/admin/login", true],
    ["/administrator", false],
    ["/portal/projects", true],
    ["/q/abc", true],
    ["/i/abc", true],
    ["/pay/return", true],
    ["/meeting/tok", true],
    ["/", false],
    ["/work/some-case", false],
    ["/invoices", false],
  ])("%s -> %s", (path, expected) => {
    expect(isPrivatePath(path)).toBe(expected);
  });
});

describe("usesNonce", () => {
  it.each([
    ["/", true],
    ["/work", true],
    ["/work/some-case", true],
    ["/blog/tags/security", true],
    ["/contact", true],
    ["/book/intro-call", true],
    ["/legal/privacy", true],
    ["/admin/inbox", true],
    ["/portal", true],
    ["/i/abc", true],
    ["/no-such-page", false],
    ["/workshop", false],
  ])("%s -> %s", (path, expected) => {
    expect(usesNonce(path)).toBe(expected);
  });
});
