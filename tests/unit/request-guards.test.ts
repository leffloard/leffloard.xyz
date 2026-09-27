import { describe, expect, it } from "vitest";
import { hasUnsafeKeys } from "@/server/security/nosql";
import { isSameOriginRequest } from "@/server/security/origin";

const SITE = "https://leffloard.xyz";

describe("isSameOriginRequest", () => {
  const check = (headers: Record<string, string>) => isSameOriginRequest(new Headers(headers), SITE);

  it("accepts the site itself and the host the browser talked to", () => {
    expect(check({ origin: "https://leffloard.xyz", "sec-fetch-site": "same-origin" })).toBe(true);
    expect(check({ origin: "http://localhost:3000", host: "localhost:3000" })).toBe(true);
    expect(check({})).toBe(true);
  });

  it("refuses other sites, sibling subdomains and opaque origins", () => {
    expect(check({ origin: "https://evil.example", host: "leffloard.xyz" })).toBe(false);
    expect(check({ origin: "https://leffloard.xyz", "sec-fetch-site": "cross-site" })).toBe(false);
    expect(check({ origin: "https://shop.leffloard.xyz", "sec-fetch-site": "same-site" })).toBe(false);
    expect(check({ origin: "null" })).toBe(false);
    expect(check({ origin: "not a url" })).toBe(false);
  });
});

describe("hasUnsafeKeys", () => {
  it.each([
    [{ email: { $ne: null } }],
    [{ "profile.role": "owner" }],
    [JSON.parse('{"__proto__": {"admin": true}}')],
    [{ list: [{ ok: 1 }, { $where: "sleep(1000)" }] }],
    [{ constructor: { prototype: {} } }],
  ])("flags %j", (value) => {
    expect(hasUnsafeKeys(value)).toBe(true);
  });

  it("passes ordinary data, including $ and dots inside values", () => {
    expect(hasUnsafeKeys({ name: "Ada", price: "$100", site: "leffloard.xyz", tags: ["a.b"] })).toBe(false);
    expect(hasUnsafeKeys(null)).toBe(false);
    expect(hasUnsafeKeys("text")).toBe(false);
  });

  it("refuses absurdly deep input", () => {
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 40; i++) deep = (deep.next = {}) as Record<string, unknown>;
    expect(hasUnsafeKeys(root)).toBe(true);
  });
});
