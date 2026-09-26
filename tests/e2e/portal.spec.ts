import type { Db } from "mongodb";
import { axeViolations, signInOwner, withDb } from "./helpers";
import { expect, test, watchPage } from "./test";

// The client portal: the owner sets up a project and invites the client; the client signs in with the link
// (opening it spends nothing), follows the project, asks for revision rounds (one past the included ones,
// with its price agreed), finds their invoices and calls, asks for a copy of their data and signs out.
// Another client's project answers 404. Runs after the billing tests (see playwright.config.ts).

test.describe.configure({ mode: "serial" });

const EMAIL = "linus.portal@example.com";
let inviteLink = "";
let projectPath = "";

async function reset(db: Db): Promise<void> {
  const client = await db.collection("clients").findOne({ email: EMAIL });
  if (client) {
    for (const name of [
      "projects",
      "portal_sessions",
      "portal_links",
      "project_updates",
      "privacy_requests",
    ]) {
      await db.collection(name).deleteMany({ clientId: client._id });
    }
    await db.collection("clients").deleteOne({ _id: client._id });
  }
  await db.collection("outbox").deleteMany({ dedupeKey: { $regex: "^portal:" } });
  await db.collection<{ _id: string }>("rate_limits").deleteMany({ _id: { $regex: "^portal" } });
}

// The newest link to the portal emailed to an address, other than those already seen. Sign-in links are
// queued just after the answer goes out, so this waits a little for one.
const seenLinks = new Set<string>();
async function linkEmailedTo(address: string): Promise<string> {
  let found: string | undefined;
  await expect
    .poll(
      async () => {
        const mail = await withDb((db) =>
          db
            .collection("outbox")
            .find({ "payload.to.address": address, dedupeKey: { $regex: "^portal:(invite|sign-in):" } })
            .sort({ _id: -1 })
            .limit(1)
            .next(),
        );
        const text = (mail?.payload as { text?: string } | undefined)?.text ?? "";
        found = /https?:\/\/[^\s]+\/portal\/verify\?t=[A-Za-z0-9_-]+/.exec(text)?.[0];
        return found !== undefined && !seenLinks.has(found);
      },
      { message: `a new portal link emailed to ${address}`, timeout: 10_000 },
    )
    .toBe(true);
  seenLinks.add(found!);
  return new URL(found!).pathname + new URL(found!).search;
}

test.beforeAll(async () => {
  await withDb(reset);
});

test("the owner sets up the project, shares its staging link, and invites the client", async ({ page }) => {
  await signInOwner(page.context());
  await page.goto("/admin/clients/new");
  await page.getByLabel("Name", { exact: true }).fill("Linus Torvalds");
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await page.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Linus Torvalds" })).toBeVisible();

  await page.getByRole("link", { name: "New project" }).click();
  await page.getByLabel("Title").fill("Kernel docs site");
  await page.getByLabel("Price", { exact: true }).fill("800");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Kernel docs site" })).toBeVisible();
  projectPath = new URL(page.url()).pathname.replace("/admin/projects/", "/portal/projects/");

  const links = page.locator("section", { has: page.getByRole("heading", { name: "Links" }) });
  await links.getByLabel("Link name").fill("Staging");
  await links.getByLabel("Address").fill("staging.example.com");
  await links.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("link", { name: /Staging/ })).toBeVisible();
  await page.getByLabel("Shared with the client: Staging").check();
  await expect(page.getByText("Shared in the client's portal.")).toBeVisible();

  await page.getByLabel("What's new").fill("The staging site is up: have a look.");
  await page.getByRole("button", { name: "Post the update" }).click();
  await expect(page.getByText("Posted, and emailed to the client.")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await page.goto("/admin/clients");
  await page.getByRole("link", { name: /Linus Torvalds/ }).click();
  await page.getByRole("button", { name: "Invite to the portal" }).click();
  await expect(page.getByText(`Invitation sent to ${EMAIL}.`)).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  inviteLink = await linkEmailedTo(EMAIL);
});

test("the client signs in with the link and follows the project", async ({ browser }) => {
  const context = await browser.newContext();
  const client = await context.newPage();
  const errors: string[] = [];
  watchPage(client, errors);
  await client.emulateMedia({ reducedMotion: "reduce" });

  // Not signed in: the portal asks to.
  await client.goto("/portal");
  await expect(client).toHaveURL(/\/portal\/login$/);

  // Opening the link twice (a mail scanner, then the person) spends nothing.
  await client.goto(inviteLink);
  await client.goto(inviteLink);
  await expect(client.getByRole("heading", { level: 1, name: "Welcome, Linus Torvalds." })).toBeVisible();
  expect(await axeViolations(client)).toEqual([]);
  await client.getByRole("button", { name: "Sign in" }).click();
  await expect(client.getByRole("heading", { level: 1, name: "Hello, Linus Torvalds." })).toBeVisible();
  await expect(client.getByRole("link", { name: /Kernel docs site/ })).toBeVisible();
  expect(await axeViolations(client)).toEqual([]);

  // The link is used up now.
  const second = await context.newPage();
  await second.goto(inviteLink);
  await expect(
    second.getByRole("heading", { name: "This link has expired or was already used." }),
  ).toBeVisible();
  await second.close();

  await client.getByRole("link", { name: /Kernel docs site/ }).click();
  await expect(client.getByRole("heading", { level: 1, name: "Kernel docs site" })).toBeVisible();
  await expect(client.getByText("The staging site is up: have a look.")).toBeVisible();
  await expect(client.getByRole("link", { name: "Staging" })).toHaveAttribute(
    "href",
    /^https:\/\/staging\.example\.com\/?$/,
  );
  await expect(client.getByText("0 of 2 included rounds used.")).toBeVisible();
  expect(await axeViolations(client)).toEqual([]);

  // Two included rounds, then one that costs extra: only with the price agreed.
  for (const title of ["Bigger code samples", "A dark theme"]) {
    await client.getByLabel("What should change?").fill(title);
    await client.getByRole("button", { name: "Send the request" }).click();
    await expect(client.getByText(/Round \d is asked for/)).toBeVisible();
  }
  await expect(client.getByText("2 of 2 included rounds used.")).toBeVisible();
  await client.getByLabel("What should change?").fill("A search box");
  await client.getByRole("button", { name: "Send the request" }).click();
  await expect(client.getByText("Tick the box to agree to the price of this round.")).toBeVisible();
  await client.getByLabel(/I agree to pay/).check();
  await client.getByRole("button", { name: "Send the request" }).click();
  await expect(client.getByText("Round 3 is asked for. I'll get back to you on it.")).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();

  const rounds = await withDb((db) =>
    db
      .collection("revisions")
      .find({ title: { $in: ["Bigger code samples", "A dark theme", "A search box"] } })
      .sort({ number: 1 })
      .toArray(),
  );
  expect(rounds.map((round) => [round.number, round.billable, round.fromPortal])).toEqual([
    [1, false, true],
    [2, false, true],
    [3, true, true],
  ]);
});

test("the client finds invoices, calls and their account, asks for their data, and signs out", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const client = await context.newPage();
  const errors: string[] = [];
  watchPage(client, errors);
  await client.emulateMedia({ reducedMotion: "reduce" });

  // A new link by email this time.
  await client.goto("/portal/login");
  expect(await axeViolations(client)).toEqual([]);
  await client.getByLabel("Your email address").fill(EMAIL);
  await client.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(client.getByText("Check your inbox.")).toBeVisible();
  await client.goto(await linkEmailedTo(EMAIL));
  await client.getByRole("button", { name: "Sign in" }).click();
  await expect(client.getByRole("heading", { level: 1, name: "Hello, Linus Torvalds." })).toBeVisible();

  await client.getByRole("link", { name: "Invoices", exact: true }).click();
  await expect(client.getByRole("heading", { level: 1, name: "Invoices and quotes" })).toBeVisible();
  await expect(client.getByText("No invoices yet.")).toBeVisible();
  expect(await axeViolations(client)).toEqual([]);

  await client.getByRole("link", { name: "Calls", exact: true }).click();
  await expect(client.getByRole("heading", { level: 2, name: "Book a call" })).toBeVisible();
  expect(await axeViolations(client)).toEqual([]);

  // Someone else's project is not found.
  const others = await withDb((db) => db.collection("projects").findOne({ title: "Shop rebuild" }));
  const denied = await client.goto(`/portal/projects/${others!._id.toHexString()}`);
  expect(denied?.status()).toBe(404);
  errors.length = 0; // the 404 itself

  await client.goto("/portal/account");
  await expect(client.getByText(EMAIL)).toBeVisible();
  expect(await axeViolations(client)).toEqual([]);
  await client.getByRole("button", { name: "Ask for a copy" }).click();
  await expect(client.getByText(/Asked\. You'll hear from me within 30 days/)).toBeVisible();

  await client.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(client).toHaveURL(/\/portal\/login$/);
  await client.goto("/portal");
  await expect(client).toHaveURL(/\/portal\/login$/);
  expect(errors).toEqual([]);
  await context.close();
});

test("the owner sees the portal's requests and answers them", async ({ page }) => {
  await signInOwner(page.context());
  await page.goto(`/admin${projectPath.replace("/portal", "")}/revisions`);
  await expect(page.getByText("from the portal")).toHaveCount(3);
  expect(await axeViolations(page)).toEqual([]);

  await page.goto("/admin/clients");
  await page.getByRole("link", { name: /Linus Torvalds/ }).click();
  const requests = page.locator("section", { has: page.getByRole("heading", { name: "Data requests" }) });
  await expect(requests.getByText("Copy of data")).toBeVisible();
  await requests.getByLabel("What you did (for the record)").fill("Sent the export by email.");
  await requests.getByRole("button", { name: "Mark as done" }).click();
  await expect(page.getByText("Marked as done.")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  const alerts = await withDb((db) =>
    db
      .collection("outbox")
      .find({ dedupeKey: { $regex: "^portal:(revision|privacy):.*:email$" } })
      .map((item) => item.label as string)
      .toArray(),
  );
  const project = await withDb((db) => db.collection("projects").findOne({ title: "Kernel docs site" }));
  const round = `Revision asked for in the portal: ${project!.ref as string}`;
  expect(alerts.sort()).toEqual(["Data request in the portal: Linus Torvalds", round, round, round]);
});
