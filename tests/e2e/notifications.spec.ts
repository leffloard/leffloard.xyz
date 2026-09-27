import { E2E_BASE_URL, OWNER } from "./fixtures";
import { axeViolations, clearIntakeLimits, signInOwner, withDb } from "./helpers";
import { expect, test } from "./test";

// The notification centre: a new message rings the bell, opening its notification goes to the message and
// marks it read, and the routes and quiet hours are saved. Runs after the other admin specs (see
// playwright.config.ts).

test.describe.configure({ mode: "serial" });

test("a new message rings the bell, and its notification opens it", async ({ page, request }) => {
  await clearIntakeLimits();
  const subject = `Notification check ${Date.now().toString(36)}`;
  const response = await request.post("/api/inquiries", {
    headers: { origin: E2E_BASE_URL },
    data: {
      kind: "question",
      name: "Grace Hopper",
      email: "grace.notify@example.com",
      subject,
      message: "Do you build desktop tools for Windows?",
    },
  });
  expect(response.status()).toBe(201);

  await signInOwner(page.context());
  await page.goto("/admin");
  const bell = page.getByRole("link", { name: /^Notifications, \d+ unread$/ });
  await expect(bell).toBeVisible();
  const unread = Number(/(\d+) unread/.exec((await bell.textContent()) ?? "")?.[1]);
  await bell.click();
  await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  const item = page.getByRole("button", { name: "New question from Grace Hopper (unread)" }).first();
  await expect(item).toBeVisible();
  await item.click();
  await expect(page).toHaveURL(/\/admin\/inbox\/[a-f0-9]{24}$/);
  await expect(page.getByRole("heading", { name: subject })).toBeVisible();
  // The bell counts one fewer.
  await expect(
    page.getByRole("link", { name: unread > 1 ? `Notifications, ${unread - 1} unread` : "Notifications" }),
  ).toBeVisible();
  const stored = await withDb((db) =>
    db
      .collection("notifications")
      .findOne({ title: "New question from Grace Hopper" }, { sort: { createdAt: -1 } }),
  );
  expect(stored?.readAt).toBeInstanceOf(Date);
});

test("routes, quiet hours and the digest are saved", async ({ page }) => {
  await signInOwner(page.context());
  await page.goto("/admin/notifications");
  await page.getByRole("checkbox", { name: "Payments by Discord" }).uncheck();
  await page.getByRole("checkbox", { name: /^Hold email and Discord alerts/ }).check();
  await page.getByRole("button", { name: "Add a quiet period" }).click();
  await page.getByLabel("Quiet period 2, from").fill("08:30");
  await page.getByRole("checkbox", { name: /^Email me a summary/ }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Payments by Discord" })).not.toBeChecked();
  await expect(page.getByLabel("Quiet period 2, from")).toHaveValue("08:30");
  const settings = await withDb((db) => db.collection("settings").findOne({ _id: "notifications" as never }));
  expect(settings).toMatchObject({
    quietEnabled: true,
    digestEnabled: true,
    routes: { payment: { discord: false } },
  });

  // The morning digest, previewed and sent on demand.
  await page.getByRole("button", { name: "Preview today's digest" }).click();
  await expect(page.getByText(/^Your day, /)).toBeVisible();
  await page.getByRole("button", { name: "Send it now" }).click();
  await expect(page.getByText(`The digest is on its way to ${OWNER.email}.`)).toBeVisible();
  await expect
    .poll(() => withDb((db) => db.collection("outbox").countDocuments({ dedupeKey: /^digest:.*:now:/ })))
    .toBe(1);

  // Back to the defaults, for anything that runs later.
  await withDb((db) => db.collection("settings").deleteOne({ _id: "notifications" as never }));
});
