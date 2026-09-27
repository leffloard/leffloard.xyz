import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { contentSecurityPolicy } from "@/lib/csp";
import { proxy } from "@/proxy";
import { cookieName, cookieOptions } from "@/server/auth/cookies";
import { readMedia, storeImage } from "@/server/content/media";
import { renderMarkdown } from "@/server/content/render";
import { closeClient } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { setupTestDb } from "../integration/db";
import { setupTestEnv } from "../integration/env";

// The rest of the surface: response headers, cookies, what Markdown may turn into, and what an upload may
// carry through.

const { db, url, name } = setupTestDb();
setupTestEnv({ MONGO_URL: url, DB_NAME: name });

beforeEach(async () => {
  await runMigrations(db());
});

afterAll(async () => {
  await closeClient();
});

describe("headers", () => {
  it("every response carries the security headers, and HSTS in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    try {
      const config = (await import("@/next.config")).default;
      const rules = await config.headers!();
      const all = rules.find((rule) => rule.source === "/:path*");
      const headers = Object.fromEntries((all?.headers ?? []).map((header) => [header.key, header.value]));
      expect(headers).toMatchObject({
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Strict-Transport-Security": "max-age=31536000",
      });
      expect(headers["Permissions-Policy"]).toContain("camera=()");
      expect(config.poweredByHeader).toBe(false);
    } finally {
      vi.stubEnv("NODE_ENV", "test");
    }
  });

  it("pages allow only their own nonce's scripts, and no framing, plugins or base changes", () => {
    const policy = contentSecurityPolicy({ nonce: "abc123", dev: false, secure: true });
    const directive = (name: string) => policy.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";
    expect(directive("script-src")).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(policy).not.toContain("unsafe-eval");
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("base-uri")).toBe("base-uri 'none'");
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive("form-action")).toBe("form-action 'self'");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("a request can't choose its own nonce, and private pages are kept out of search engines", () => {
    const request = new NextRequest("https://leffloard.test/portal", {
      headers: { "content-security-policy": "script-src 'nonce-attacker'", "x-nonce": "attacker" },
    });
    const response = proxy(request);
    const policy = response.headers.get("content-security-policy") ?? "";
    expect(policy).toMatch(/'nonce-[A-Za-z0-9+/=]{24}'/);
    expect(policy).not.toContain("attacker");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(proxy(new NextRequest("https://leffloard.test/work")).headers.get("x-robots-tag")).toBeNull();
  });
});

describe("cookies", () => {
  it("are HttpOnly, Secure and host-only over https, and never sent cross-site where they needn't be", () => {
    for (const kind of ["session", "pending", "webauthn", "portal", "preview"] as const) {
      expect(cookieName(kind)).toBe(`__Host-lf_${kind}`);
      const options = cookieOptions(kind, 600);
      expect(options).toMatchObject({ httpOnly: true, secure: true, path: "/", maxAge: 600 });
      expect(options.sameSite).toBe(kind === "pending" || kind === "webauthn" ? "strict" : "lax");
      expect(options).not.toHaveProperty("domain");
    }
  });
});

describe("Markdown", () => {
  // Classic ways to run script or leave the site from content (all of it is the owner's, but a paste from
  // anywhere must not become code on the public site).
  const CORPUS = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "[click](javascript:alert(1))",
    "[click](JAVASCRIPT:alert(1))",
    "[click](java&#x09;script:alert(1))",
    '<a href="javascript:alert(1)">x</a>',
    '<a href="data:text/html,<script>alert(1)</script>">x</a>',
    '<iframe src="https://evil.example"></iframe>',
    "<svg><script>alert(1)</script></svg>",
    "<svg onload=alert(1)>",
    "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>",
    '<object data="x"></object><embed src="x">',
    '<form action="https://evil.example"><input name="q"></form>',
    '<div style="background:url(javascript:alert(1))">x</div>',
    "![x](javascript:alert(1))",
    "![x](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)",
    "![x](https://tracker.example/pixel.gif)",
    "<details open ontoggle=alert(1)>x</details>",
    '<base href="https://evil.example/">',
    '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    '<link rel="stylesheet" href="https://evil.example/x.css">',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    "```html\n<script>alert(1)</script>\n```",
  ];

  it("never becomes script, a frame, a form, a style or an outside image", async () => {
    const problems: string[] = [];
    for (const input of CORPUS) {
      const { html } = await renderMarkdown(input);
      const found = [
        /<(script|iframe|object|embed|form|input|base|meta|link|style|svg|math)\b/i.test(html) &&
          "a banned element",
        /\son[a-z]+\s*=/i.test(html) && "an event handler",
        // The code highlighter's colours are the only style allowed: its own CSS variables, nothing else.
        [...html.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)].some(
          (match) => !/^(--shiki-[a-z-]+:#[0-9a-f]{3,8};?)+$/i.test(match[1]!),
        ) && "a style attribute",
        /(href|src)\s*=\s*"\s*(javascript|data|vbscript):/i.test(html) && "a script or data address",
        [...html.matchAll(/<img[^>]*\ssrc="([^"]*)"/gi)].some(
          (match) => !/^\/media\/[a-f0-9]{64}\.webp$/.test(match[1]!),
        ) && "an image from outside the media library",
      ].filter(Boolean);
      if (found.length) problems.push(`${JSON.stringify(input)} \u2192 ${found.join(", ")}: ${html}`);
    }
    expect(problems).toEqual([]);
  });

  it("still shows code as text", async () => {
    const { html } = await renderMarkdown("```html\n<script>alert(1)</script>\n```");
    expect(html).toContain("&#x3C;");
    expect(html).not.toMatch(/<script\b/i);
  });
});

describe("uploads", () => {
  const payload = "<script>alert(document.cookie)</script>";

  it("refuse files that only pretend to be images", async () => {
    const fakes: [string, Uint8Array][] = [
      ["an HTML page named .png", new TextEncoder().encode(`<!doctype html>${payload}`)],
      [
        "an SVG with a script",
        new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg">${payload}</svg>`),
      ],
      [
        "a GIF header in front of JavaScript",
        new TextEncoder().encode(`GIF89a/*${"\u0000".repeat(16)}*/=1;alert(1)`),
      ],
      ["a PNG signature and nothing else", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ];
    for (const [label, bytes] of fakes) {
      const result = await storeImage(db(), { bytes, name: "image.png", alt: label });
      expect(result.ok, label).toBe(false);
    }
    expect(await db().collection("media").countDocuments()).toBe(0);
  });

  it("re-encode real images, so nothing appended or hidden in them survives", async () => {
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#22d3ee" } })
      .png()
      .withMetadata({ exif: { IFD0: { ImageDescription: payload } } })
      .toBuffer();
    const polyglot = Buffer.concat([png, Buffer.from(`<html>${payload}</html>`)]);
    const result = await storeImage(db(), { bytes: polyglot, name: "../../evil.html.png", alt: "x" });
    if (!result.ok) throw new Error(result.message);
    expect(result.media.src).toMatch(/^\/media\/[a-f0-9]{64}\.webp$/);
    expect(result.media.name).toBe("evil.html.png");
    const stored = await readMedia(db(), result.media.id);
    expect(stored?.contentType).toBe("image/webp");
    expect(stored?.bytes.includes(Buffer.from("script"))).toBe(false);
    expect(stored?.bytes.includes(Buffer.from("<html>"))).toBe(false);
  });
});
