import { gzipSync } from "node:zlib";
import type { Page } from "@playwright/test";
import { expect, test } from "./test";

// What a first visit downloads, per page: JavaScript and CSS gzipped (as "next start" sends them; Cloudflare's
// Brotli is smaller still) and fonts as they are (WOFF2 is compressed already). The budgets are the plan's:
// 150 KB of JavaScript, 30 KB of CSS and 80 KB of fonts; the two pages with a form may use 20 KB more
// JavaScript for it. A failure lists the files, largest first.

const KB = 1024;
const BUDGET = { script: 150 * KB, stylesheet: 30 * KB, font: 80 * KB };
const FORM_EXTRA = 20 * KB;

const PAGES = [
  "/",
  "/work",
  "/services",
  "/pricing",
  "/about",
  "/cv",
  "/blog",
  "/book",
  { path: "/contact", extraScript: FORM_EXTRA },
  { path: "/book/intro-call", extraScript: FORM_EXTRA },
];

type Kind = keyof typeof BUDGET;
type Download = { kind: Kind; url: string; bytes: number };

async function downloads(page: Page, path: string): Promise<Download[]> {
  const pending: Promise<Download | null>[] = [];
  page.on("response", (response) => {
    const kind = response.request().resourceType();
    if (!(kind in BUDGET) || response.status() !== 200) return;
    pending.push(
      response.body().then(
        (body) => ({
          kind: kind as Kind,
          url: new URL(response.url()).pathname,
          bytes: kind === "font" ? body.length : gzipSync(body).length,
        }),
        () => null,
      ),
    );
  });
  await page.goto(path, { waitUntil: "networkidle" });
  // What loads once the page is idle (the hero's animation, for one) counts too.
  await page.evaluate(() => new Promise((resolve) => requestIdleCallback(() => setTimeout(resolve, 1000))));
  await page.waitForLoadState("networkidle");
  return (await Promise.all(pending)).filter((download) => download !== null);
}

for (const entry of PAGES) {
  const { path, extraScript = 0 } = typeof entry === "string" ? { path: entry } : entry;

  test(`${path} stays within its download budget`, async ({ page }) => {
    const files = await downloads(page, path);
    expect(files.some((file) => file.kind === "script")).toBe(true);
    for (const kind of Object.keys(BUDGET) as Kind[]) {
      const budget = BUDGET[kind] + (kind === "script" ? extraScript : 0);
      const ofKind = files.filter((file) => file.kind === kind).sort((a, b) => b.bytes - a.bytes);
      const total = ofKind.reduce((sum, file) => sum + file.bytes, 0);
      const list = ofKind.map((file) => `${(file.bytes / KB).toFixed(1)} KB ${file.url}`).join("\n");
      expect(
        total,
        `${kind}: ${(total / KB).toFixed(1)} KB of ${(budget / KB).toFixed(0)} KB\n${list}`,
      ).toBeLessThanOrEqual(budget);
    }
  });
}
