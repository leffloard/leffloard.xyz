import { describe, expect, it } from "vitest";
import { normalizeCspReports, redactUrl } from "@/lib/csp-reports";

describe("normalizeCspReports", () => {
  it("reads the old report-uri format", () => {
    expect(
      normalizeCspReports({
        "csp-report": {
          "document-uri": "https://leffloard.xyz/q/SECRET123?x=1",
          "effective-directive": "script-src-elem",
          "blocked-uri": "inline",
          "line-number": 12,
          "script-sample": "alert(1)",
        },
      }),
    ).toEqual([
      {
        documentUrl: "https://leffloard.xyz/q/:token",
        directive: "script-src-elem",
        blockedUrl: "inline",
        sourceFile: "",
        line: 12,
        disposition: "enforce",
        sample: "alert(1)",
      },
    ]);
  });

  it("reads Reporting API batches and ignores other report types", () => {
    const reports = normalizeCspReports([
      { type: "deprecation", body: { message: "x" } },
      {
        type: "csp-violation",
        body: {
          documentURL: "https://leffloard.xyz/admin",
          effectiveDirective: "style-src-elem",
          blockedURL: "https://cdn.example/a.css?v=1",
          disposition: "report",
        },
      },
    ]);
    expect(reports).toEqual([
      expect.objectContaining({
        directive: "style-src-elem",
        blockedUrl: "https://cdn.example/a.css",
        disposition: "report",
      }),
    ]);
  });

  it("drops garbage and caps the batch", () => {
    expect(normalizeCspReports("nope")).toEqual([]);
    expect(normalizeCspReports({ "csp-report": {} })).toEqual([]);
    const many = Array.from({ length: 50 }, () => ({
      type: "csp-violation",
      body: { effectiveDirective: "img-src" },
    }));
    expect(normalizeCspReports(many)).toHaveLength(10);
  });
});

describe("redactUrl", () => {
  it("removes queries and link tokens", () => {
    expect(redactUrl("https://leffloard.xyz/i/abc123/pay?session=zzz#frag")).toBe(
      "https://leffloard.xyz/i/:token/pay",
    );
    expect(redactUrl("https://leffloard.xyz/meeting/tok")).toBe("https://leffloard.xyz/meeting/:token");
    expect(redactUrl("eval")).toBe("eval");
    expect(redactUrl(42)).toBe("");
  });
});
