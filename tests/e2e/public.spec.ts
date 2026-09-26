import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./test";

const PAGES = [
  "/",
  "/work",
  "/work/leffloard-xyz",
  "/work/partnership-ledger-bot",
  "/work/miniengine",
  "/services",
  "/services/websites",
  "/services/auth-and-licensing",
  "/pricing",
  "/about",
  "/cv",
  "/contact",
  "/blog",
  "/blog/how-this-site-signs-me-in",
  "/blog/tags/security",
  "/legal/privacy",
  "/legal/terms",
  "/legal/refunds",
  "/colophon",
];

for (const path of PAGES) {
  test(`${path} renders, passes axe and fits a phone screen`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page).toHaveTitle(/Mert Kaan Koparan/);

    const headers = response!.headers();
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).not.toContain("'nonce-");
    expect(headers["x-robots-tag"]).toBeUndefined();

    // Scroll-driven reveals keep content below the fold transparent until it is scrolled into view, which
    // axe would report as low contrast; with reduced motion everything is shown at once.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      axe.violations.map(
        (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(" ")}`,
      ),
    ).toEqual([]);

    await page.setViewportSize({ width: 360, height: 800 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("light theme also passes axe", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  for (const path of ["/", "/pricing", "/blog/let-the-model-read-never-count"]) {
    await page.goto(path);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2aa"]).analyze();
    expect(axe.violations.map((violation) => violation.id)).toEqual([]);
  }
});

test("the home page's shader stays off with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.waitForTimeout(1500);
  await expect(page.locator("canvas")).not.toHaveAttribute("data-ready", "true");
});

test("machine-readable files", async ({ request }) => {
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const sitemapText = await sitemap.text();
  expect(sitemapText).toContain("https://leffloard.xyz/work/miniengine");
  expect(sitemapText).not.toContain("/admin");

  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /admin");
  expect(robots).toContain("Sitemap: https://leffloard.xyz/sitemap.xml");

  const rss = await request.get("/blog/rss.xml");
  expect(rss.headers()["content-type"]).toContain("application/rss+xml");
  expect(await rss.text()).toContain("<title>How the admin of this site signs me in</title>");

  const pdf = await request.get("/cv.pdf");
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  const traversal = await request.get("/..%2F..%2Fetc%2Fpasswd");
  expect(await traversal.text()).not.toContain("root:");

  const security = await (await request.get("/.well-known/security.txt")).text();
  expect(security).toMatch(/^Contact: mailto:/m);
  expect(security).toMatch(/^Expires: \d{4}-/m);

  const home = await (await request.get("/")).text();
  const ogUrl = /<meta property="og:image" content="([^"]+)"/.exec(home)?.[1];
  expect(ogUrl).toMatch(/^https:\/\/leffloard\.xyz\/opengraph-image/);
  const og = await request.get(new URL(ogUrl!).pathname);
  expect(og.headers()["content-type"]).toBe("image/png");
});

test("old v1 addresses redirect", async ({ request }) => {
  const oldPost = await request.get("/blog/2", { maxRedirects: 0 });
  expect(oldPost.status()).toBe(308);
  expect(oldPost.headers().location).toBe("/blog");

  const oldForm = await request.get("/?type=appointment", { maxRedirects: 0 });
  expect(oldForm.status()).toBe(307);
  expect(oldForm.headers().location).toBe("/contact?type=appointment");
});

test.describe("missing pages", () => {
  test.use({ allowedErrors: /http 404|status of 404/ });

  test("unknown work and posts are 404s inside the site's design", async ({ page }) => {
    for (const path of ["/work/not-a-project", "/blog/not-a-post"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { name: "This page does not exist." })).toBeVisible();
    }
  });
});
