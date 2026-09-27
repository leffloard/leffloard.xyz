import type { Page } from "@playwright/test";
import type { Document, Filter } from "mongodb";
import { LIST_KINDS } from "@/lib/content/schemas";
import { axeViolations, signInOwner, withDb } from "./helpers";
import { expect, test } from "./test";

// Every admin page through axe (WCAG 2.2 A and AA), after all the other tests: by then the lists have
// something in them, and the pages about one client, project, invoice and so on open one the tests made.
// The sign-in pages are checked in admin-auth.spec.ts, the public pages in public.spec.ts, and the portal
// and the pages behind links in their own specs.

const PAGES = [
  "/admin",
  "/admin/inbox",
  "/admin/calendar",
  "/admin/calendar/availability",
  "/admin/calendar/new",
  "/admin/calendar/types",
  "/admin/clients",
  "/admin/clients/new",
  "/admin/projects",
  "/admin/projects/new",
  "/admin/tasks",
  "/admin/time",
  "/admin/billing",
  "/admin/billing/quotes",
  "/admin/billing/quotes/new",
  "/admin/billing/invoices",
  "/admin/billing/invoices/new",
  "/admin/billing/payments",
  "/admin/billing/recurring",
  "/admin/billing/recurring/new",
  "/admin/billing/settings",
  "/admin/finance",
  "/admin/finance/expenses",
  "/admin/finance/expenses/new",
  "/admin/finance/export",
  "/admin/finance/rates",
  "/admin/content",
  ...LIST_KINDS.flatMap((kind) => [`/admin/content/${kind}`, `/admin/content/${kind}/new`]),
  "/admin/content/profile",
  "/admin/content/cv",
  "/admin/content/pricing",
  "/admin/content/github",
  "/admin/content/media",
  "/admin/content/settings",
  "/admin/ai",
  "/admin/analytics",
  "/admin/notifications",
  "/admin/security",
  "/admin/settings",
  "/admin/system",
];

// A client to address a new quote or invoice to: the oldest, or a new one.
async function clientQuery(page: Page): Promise<string> {
  const oldest = () =>
    withDb((db) => db.collection("clients").findOne({}, { sort: { _id: 1 }, projection: { _id: 1 } }));
  if (!(await oldest())) {
    await page.goto("/admin/clients/new");
    await page.getByLabel("Name", { exact: true }).fill("Katherine Johnson");
    await page.getByLabel("Email", { exact: true }).fill("katherine@example.com");
    await page.getByRole("button", { name: "Add client" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Katherine Johnson" })).toBeVisible();
  }
  return `?client=${(await oldest())!._id.toHexString()}`;
}

async function draftDocument(page: Page, kind: "quote" | "invoice"): Promise<void> {
  await page.goto(`/admin/billing/${kind}s/new${await clientQuery(page)}`);
  await page.getByLabel("Title").fill("Accessibility check");
  await page.getByLabel("Line 1, description").fill("One line");
  await page.getByLabel("Line 1, unit price").fill("100");
  await page.getByRole("button", { name: `Create the ${kind}` }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Draft ${kind}: Accessibility check` }),
  ).toBeVisible();
}

// Pages about one record, opened for the oldest that matches (`{id}` is its id). Kinds the other tests don't
// leave behind are made here first.
const RECORD_PAGES: {
  collection: string;
  filter?: Filter<Document>;
  paths: string[];
  make?: (page: Page) => Promise<void>;
}[] = [
  { collection: "inquiries", paths: ["/admin/inbox/{id}"] },
  { collection: "clients", paths: ["/admin/clients/{id}", "/admin/clients/{id}/edit"] },
  {
    collection: "projects",
    paths: ["", "/edit", "/tasks", "/revisions", "/time"].map((tab) => `/admin/projects/{id}${tab}`),
  },
  { collection: "tasks", paths: ["/admin/tasks/{id}"] },
  { collection: "meetings", paths: ["/admin/calendar/meetings/{id}"] },
  // A draft opens in the editor, a sent quote or an issued invoice as the document.
  {
    collection: "quotes",
    filter: { status: "draft" },
    paths: ["/admin/billing/quotes/{id}"],
    make: (page) => draftDocument(page, "quote"),
  },
  { collection: "quotes", filter: { status: { $ne: "draft" } }, paths: ["/admin/billing/quotes/{id}"] },
  {
    collection: "invoices",
    filter: { status: "draft" },
    paths: ["/admin/billing/invoices/{id}"],
    make: (page) => draftDocument(page, "invoice"),
  },
  { collection: "invoices", filter: { status: { $ne: "draft" } }, paths: ["/admin/billing/invoices/{id}"] },
  { collection: "recurring_invoices", paths: ["/admin/billing/recurring/{id}"] },
  { collection: "expenses", paths: ["/admin/finance/expenses/{id}"] },
  ...LIST_KINDS.map((kind) => ({
    collection: "content",
    filter: { kind },
    paths: [`/admin/content/${kind}/{id}`],
  })),
];
// Real testimonials come with consent, so the seed has none: one draft, never published.
RECORD_PAGES.find((entry) => entry.filter?.kind === "testimonial")!.make = async (page) => {
  await page.goto("/admin/content/testimonial/new");
  await page.getByLabel("Quote").fill("Clear, quick and careful.");
  await page.getByLabel("Name", { exact: true }).fill("Dorothy Vaughan");
  await page.getByRole("button", { name: "Create the draft" }).click();
  await expect(page).toHaveURL(/\/admin\/content\/testimonial\/[a-f0-9]{24}(\?|$)/);
};

test.beforeEach(async ({ page }) => {
  await signInOwner(page.context());
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function passesAxe(page: Page, path: string): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
}

for (const path of PAGES) {
  test(`${path} passes axe`, async ({ page }) => {
    await passesAxe(page, path);
  });
}

for (const entry of RECORD_PAGES) {
  const { collection, filter = {}, paths } = entry;
  const label = Object.keys(filter).length ? `${collection} ${JSON.stringify(filter)}` : collection;
  test(`the pages of one of the ${label} pass axe`, async ({ page }) => {
    const find = () =>
      withDb((db) => db.collection(collection).findOne(filter, { sort: { _id: 1 }, projection: { _id: 1 } }));
    let record = await find();
    if (!record && entry.make) {
      await entry.make(page);
      record = await find();
    }
    // Run on its own (--no-deps), the database has only what a new site has.
    test.skip(!record, `The other tests left no ${label}.`);
    for (const path of paths) await passesAxe(page, path.replace("{id}", String(record!._id)));
  });
}
