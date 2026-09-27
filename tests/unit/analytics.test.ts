import { describe, expect, it } from "vitest";
import {
  analyticsPayload,
  cleanPath,
  cleanTag,
  isBot,
  isOwnReferrer,
  percentile,
  referrerHost,
} from "@/lib/analytics/clean";
import { deviceFor, formatVital, isRange, rateVital } from "@/lib/analytics/model";
import { DailyCap, MemoryLimiter } from "@/server/security/memory-limit";

describe("visitor statistics: cleaning what browsers send", () => {
  it("keeps plain site paths only, without query strings or trailing slashes", () => {
    expect(cleanPath("/")).toBe("/");
    expect(cleanPath("/work/tirego/")).toBe("/work/tirego");
    expect(cleanPath("/blog/post?utm_source=x#top")).toBe("/blog/post");
    expect(cleanPath("/a//b")).toBe("/a/b");
    expect(cleanPath("https://evil.example/")).toBeNull();
    expect(cleanPath("work")).toBeNull();
    expect(cleanPath("/with space")).toBeNull();
    expect(cleanPath("/back\\slash")).toBeNull();
    expect(cleanPath("/zero\u200bwidth")).toBeNull();
    expect(cleanPath(`/${"a".repeat(250)}`)).toBeNull();
    expect(cleanPath(42)).toBeNull();
    // The same answer every time (no regular expression state carried between calls).
    expect(cleanPath("/ok")).toBe("/ok");
    expect(cleanPath("/ok")).toBe("/ok");
  });

  it("reads the referring site's name, and knows the site's own pages", () => {
    expect(referrerHost("https://news.ycombinator.com/item?id=1", "leffloard.xyz")).toBe(
      "news.ycombinator.com",
    );
    expect(referrerHost("https://www.google.com/", "leffloard.xyz")).toBe("google.com");
    expect(referrerHost("android-app://com.google.android.gm/", "leffloard.xyz")).toBe(
      "com.google.android.gm",
    );
    expect(referrerHost("https://www.leffloard.xyz/work", "leffloard.xyz")).toBeNull();
    expect(referrerHost("javascript:alert(1)", "leffloard.xyz")).toBeNull();
    expect(referrerHost("", "leffloard.xyz")).toBeNull();
    expect(isOwnReferrer("https://leffloard.xyz/about", "leffloard.xyz")).toBe(true);
    expect(isOwnReferrer("https://other.xyz/", "leffloard.xyz")).toBe(false);
    expect(isOwnReferrer(undefined, "leffloard.xyz")).toBe(false);
  });

  it("cleans campaign tags", () => {
    expect(cleanTag("  Newsletter ")).toBe("newsletter");
    expect(cleanTag("launch\u202e2026")).toBe("launch2026");
    expect(cleanTag("x".repeat(100))).toHaveLength(60);
    expect(cleanTag("   ")).toBeNull();
    expect(cleanTag(null)).toBeNull();
  });

  it("recognises bots and scripts, not browsers", () => {
    const chrome =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
    const iphone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    expect(isBot(chrome)).toBe(false);
    expect(isBot(iphone)).toBe(false);
    expect(isBot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
    expect(isBot("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0")).toBe(true);
    expect(isBot("curl/8.5.0")).toBe(true);
    expect(isBot("python-requests/2.32")).toBe(true);
    expect(isBot("")).toBe(true);
  });

  it("accepts only the two message shapes the tracker sends", () => {
    expect(analyticsPayload.safeParse({ type: "view", path: "/", entry: true }).success).toBe(true);
    expect(
      analyticsPayload.safeParse({ type: "vitals", path: "/", metrics: { LCP: 1200, CLS: 0.01 } }).success,
    ).toBe(true);
    expect(analyticsPayload.safeParse({ type: "goal", goal: "inquiry" }).success).toBe(false);
    expect(analyticsPayload.safeParse({ type: "view", path: "/", entry: true, ip: "1.2.3.4" }).success).toBe(
      false,
    );
    expect(analyticsPayload.safeParse({ type: "vitals", path: "/", metrics: { FID: 3 } }).success).toBe(
      false,
    );
    expect(analyticsPayload.safeParse({ type: "vitals", path: "/", metrics: { LCP: -1 } }).success).toBe(
      false,
    );
    expect(analyticsPayload.safeParse({ type: "view", path: "/", entry: true, device: "tv" }).success).toBe(
      false,
    );
  });
});

describe("visitor statistics: reading the numbers", () => {
  it("takes the nearest-rank percentile", () => {
    expect(percentile([], 75)).toBeNull();
    expect(percentile([5], 75)).toBe(5);
    expect(percentile([4, 1, 3, 2], 75)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 75)).toBe(8);
  });

  it("rates loading timings by Google's thresholds", () => {
    expect(rateVital("LCP", 2500)).toBe("good");
    expect(rateVital("LCP", 2501)).toBe("improve");
    expect(rateVital("LCP", 4001)).toBe("poor");
    expect(rateVital("CLS", 0.1)).toBe("good");
    expect(rateVital("INP", 600)).toBe("poor");
    expect(formatVital("LCP", 1840)).toBe("1.84 s");
    expect(formatVital("INP", 120.4)).toBe("120 ms");
    expect(formatVital("CLS", 0.052)).toBe("0.05");
  });

  it("names devices by window width, and knows the ranges", () => {
    expect(deviceFor(390)).toBe("mobile");
    expect(deviceFor(800)).toBe("tablet");
    expect(deviceFor(1440)).toBe("desktop");
    expect(isRange("7d")).toBe(true);
    expect(isRange("1y")).toBe(false);
  });

  it("caps a day, says once when it fills, and starts again the next day", () => {
    const cap = new DailyCap(2);
    expect(cap.take("2026-09-26")).toBe("allowed");
    expect(cap.take("2026-09-26")).toBe("allowed");
    expect(cap.take("2026-09-26")).toBe("just-full");
    expect(cap.take("2026-09-26")).toBe("full");
    expect(cap.take("2026-09-27")).toBe("allowed");
  });

  it("limits in memory, forgetting the least recently used addresses first", () => {
    const limiter = new MemoryLimiter(2, 1000, 3);
    expect(limiter.hit("a", 0)).toBe(true);
    expect(limiter.hit("a", 10)).toBe(true);
    expect(limiter.hit("a", 20)).toBe(false);
    // The window slides: the first attempt has left it.
    expect(limiter.hit("a", 1001)).toBe(true);
    for (const key of ["b", "c", "d"]) limiter.hit(key, 1100);
    // "a" was used longest ago and was dropped, so it starts again.
    expect(limiter.hit("a", 1200)).toBe(true);
    expect(limiter.hit("a", 1201)).toBe(true);
  });
});
