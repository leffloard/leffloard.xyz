import { axeViolations, signInOwner, withDb } from "./helpers";
import { expect, test, watchPage } from "./test";

// Visitor statistics: a visit is counted without cookies or storage, browsers that ask not to be tracked
// and the signed-in owner aren't counted, and the Analytics page shows the visit, its campaign, a broken
// link and the loading timings. Runs last (see playwright.config.ts).

test.describe.configure({ mode: "serial" });
// Its own address, so the collector's per-address limit isn't shared with the rest of the suite.
test.use({
  extraHTTPHeaders: { "x-forwarded-for": "203.0.113.77" },
  allowedErrors: /http 404: .*\/(blog\/no-such-post|no-such-section-)|status of 404/,
});

const run = Date.now().toString(36);
const campaign = (name: string) => `e2e-${name}-${run}`;

async function countEvents(filter: Record<string, unknown>): Promise<number> {
  return withDb((db) => db.collection("analytics_events").countDocuments(filter));
}

test("a visit is counted without cookies, and the Analytics page shows it", async ({ page, browser }) => {
  // A browser that asks not to be tracked sends nothing.
  const private_ = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.78" } });
  await private_.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true });
  });
  const privatePage = await private_.newPage();
  await privatePage.goto(`/?utm_campaign=${campaign("gpc")}`);

  await page.goto(`/?utm_source=e2e&utm_campaign=${campaign("visit")}`);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Work" }).click();
  await expect(page).toHaveURL(/\/work$/);
  const response = await page.goto("/blog/no-such-post");
  expect(response?.status()).toBe(404);
  // An address that matches no route at all is a broken link too.
  const missing = `/no-such-section-${run}`;
  expect((await page.goto(missing))?.status()).toBe(404);
  await expect.poll(() => countEvents({ path: missing, notFound: true })).toBe(1);
  // Leaving the page sends its loading timings.
  await page.goto("about:blank");

  await expect.poll(() => countEvents({ campaign: campaign("visit") })).toBe(1);
  await expect.poll(() => countEvents({ path: "/blog/no-such-post", notFound: true })).toBeGreaterThan(0);
  await expect
    .poll(() => withDb((db) => db.collection("analytics_vitals").countDocuments({ path: "/" })))
    .toBeGreaterThan(0);
  const [visit] = await withDb((db) =>
    db
      .collection("analytics_events")
      .find({ campaign: campaign("visit") })
      .toArray(),
  );
  expect(visit).toMatchObject({ path: "/", entry: true, source: "e2e", device: "desktop" });
  const work = await countEvents({ visitor: visit?.visitor, path: "/work", entry: false });
  expect(work).toBe(1);
  // Nothing was stored in the browser.
  expect(await page.context().cookies()).toEqual([]);
  expect(await page.context().storageState()).toMatchObject({ cookies: [], origins: [] });
  expect(await countEvents({ campaign: campaign("gpc") })).toBe(0);
  await private_.close();

  // The owner, signed in, isn't counted.
  const admin = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.79" } });
  await signInOwner(admin);
  const adminPage = await admin.newPage();
  const errors: string[] = [];
  watchPage(adminPage, errors);
  await adminPage.goto(`/?utm_campaign=${campaign("owner")}`);

  await adminPage.goto("/admin/analytics?range=7d");
  await expect(adminPage.getByRole("heading", { name: "Analytics", level: 1 })).toBeVisible();
  await expect(adminPage.getByRole("cell", { name: campaign("visit") })).toBeVisible();
  const broken = adminPage.locator("section", {
    has: adminPage.getByRole("heading", { name: "Broken links" }),
  });
  await expect(broken.getByRole("cell", { name: "/blog/no-such-post" })).toBeVisible();
  await expect(adminPage.getByText(/good · \d+ page loads?/).first()).toBeVisible();
  expect(await axeViolations(adminPage)).toEqual([]);
  expect(await countEvents({ campaign: campaign("owner") })).toBe(0);

  await adminPage.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Today" }).click();
  await expect(adminPage.getByRole("heading", { name: "Traffic" })).toBeVisible();
  expect(errors).toEqual([]);
  await admin.close();
});

test("a CV download is a goal, and a link checker's HEAD request isn't", async ({ request }) => {
  const before = await countEvents({ goal: "cv" });
  const head = await request.head("/cv.pdf");
  expect(head.status()).toBe(200);
  expect(head.headers()["content-type"]).toBe("application/pdf");
  const pdf = await request.get("/cv.pdf");
  expect(pdf.status()).toBe(200);
  await expect.poll(() => countEvents({ goal: "cv" })).toBe(before + 1);
});
