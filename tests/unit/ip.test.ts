import { describe, expect, it } from "vitest";
import { clientIp, ipKey } from "@/lib/ip";

describe("ipKey", () => {
  it.each([
    ["198.51.100.66", "198.51.100.66"],
    ["198.51.100.66:4711", "198.51.100.66"],
    [" 203.0.113.9 ", "203.0.113.9"],
    ["[2001:db8:1:2:3:4:5:6]:443", "2001:db8:1:2::/64"],
    ["2001:db8:1:2:aaaa::1", "2001:db8:1:2::/64"],
    ["2001:0db8:0000:0002:ffff:ffff:ffff:ffff", "2001:db8:0:2::/64"],
    ["2001:db8::1", "2001:db8::/64"],
    ["::1", "::/64"],
    ["fe80::1%eth0", "fe80::/64"],
    ["::ffff:198.51.100.7", "198.51.100.7"],
    ["::ffff:c633:6407", "198.51.100.7"],
  ])("%s -> %s", (input, expected) => {
    expect(ipKey(input)).toBe(expected);
  });

  it.each(["", "not-an-ip", "testclient", "999.1.1.1", "1.2.3", "2001:db8:::1"])("rejects %j", (input) => {
    expect(ipKey(input)).toBeNull();
  });
});

describe("clientIp", () => {
  const headers = (entries: Record<string, string>) => new Headers(entries);

  it("uses CF-Connecting-IP behind Cloudflare", () => {
    const request = headers({
      "cf-connecting-ip": "203.0.113.5",
      "x-forwarded-for": "10.0.0.1, 198.51.100.1",
    });
    expect(clientIp(request, "cloudflare")).toBe("203.0.113.5");
  });

  it("ignores CF-Connecting-IP unless Cloudflare is the configured source", () => {
    const request = headers({ "cf-connecting-ip": "203.0.113.5", "x-forwarded-for": "198.51.100.1" });
    expect(clientIp(request, "socket")).toBe("198.51.100.1");
  });

  it("takes the last X-Forwarded-For entry, the one added by the nearest proxy", () => {
    expect(clientIp(headers({ "x-forwarded-for": "6.6.6.6, 198.51.100.66" }), "socket")).toBe(
      "198.51.100.66",
    );
    expect(clientIp(headers({ "x-forwarded-for": "6.6.6.6, 198.51.100.66" }), "cloudflare")).toBe(
      "198.51.100.66",
    );
  });

  it("falls back to 'unknown'", () => {
    expect(clientIp(headers({}), "socket")).toBe("unknown");
    expect(clientIp(headers({ "x-forwarded-for": "garbage" }), "socket")).toBe("unknown");
    expect(clientIp(headers({ "cf-connecting-ip": "garbage" }), "cloudflare")).toBe("unknown");
  });
});
