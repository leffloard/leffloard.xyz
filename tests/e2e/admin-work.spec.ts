import { readFileSync } from "node:fs";
import { E2E_BASE_URL } from "./fixtures";
import { axeViolations, clearIntakeLimits, signInOwner, withDb } from "./helpers";
import { expect, test } from "./test";

// From an inbox message to a client, a project, its board, time and revision rounds. Runs after the inbox
// tests (see playwright.config.ts), one step after another.

test.describe.configure({ mode: "serial" });

const SENDER = "grace.work@example.com";

test.beforeAll(async ({ request }) => {
  await withDb(async (db) => {
    for (const name of ["clients", "projects", "tasks", "revisions", "time_entries", "activities"]) {
      await db.collection(name).deleteMany({});
    }
    await db.collection("inquiries").deleteMany({ email: SENDER });
  });
  await clearIntakeLimits();
  const response = await request.post("/api/inquiries", {
    headers: { origin: E2E_BASE_URL },
    data: {
      kind: "brief",
      service: "websites",
      subject: "Shop rebuild",
      message: "Our shop needs a faster site with a product catalogue.",
      budget: "1500-3000",
      timeline: "1-month",
      name: "Grace Hopper",
      email: SENDER,
      company: "Cobol & Co",
    },
  });
  expect(response.status()).toBe(201);
});

test.beforeEach(async ({ context }) => {
  await signInOwner(context);
});

async function projectId(): Promise<string> {
  const project = await withDb((db) => db.collection("projects").findOne({ title: "Shop rebuild" }));
  return project!._id.toHexString();
}

test("a message becomes a client, then a project", async ({ page }) => {
  const inquiry = await withDb((db) => db.collection("inquiries").findOne({ email: SENDER }));
  await page.goto(`/admin/inbox/${inquiry!._id.toHexString()}`);
  const card = page.locator("section", { has: page.getByRole("heading", { name: "Client", exact: true }) });
  await card.getByRole("button", { name: "Make the sender a client" }).click();
  await expect(card.getByText("Grace Hopper is now a client.")).toBeVisible();
  await expect(card.getByRole("link", { name: "Grace Hopper" })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await card.getByRole("link", { name: "Start a project" }).click();
  await expect(page).toHaveURL(/\/admin\/projects\/new\?inquiry=/);
  await expect(page.getByLabel("Title")).toHaveValue("Shop rebuild");
  await expect(page.getByLabel("Client")).toHaveValue(/[a-f0-9]{24}/);
  await expect(page.getByLabel("Included revision rounds")).toHaveValue("2");
  expect(await axeViolations(page)).toEqual([]);

  await page.getByLabel("Price", { exact: true }).fill("12,50");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByText(/Use digits and a dot for decimals/)).toBeVisible();
  await page.getByLabel("Price", { exact: true }).fill("1,200");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/admin\/projects\/[a-f0-9]{24}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Shop rebuild" })).toBeVisible();
  await expect(page.getByText("PRJ-001", { exact: true })).toBeVisible();
  await expect(page.getByText("$1,200")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await page.goto("/admin/clients");
  await page.getByRole("link", { name: /Grace Hopper/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Grace Hopper" })).toBeVisible();
  const timeline = page.locator("section", { has: page.getByRole("heading", { name: "Timeline" }) });
  await expect(timeline.getByRole("link", { name: "Shop rebuild" })).toHaveCount(2); // the message and the project
  await expect(page.getByLabel("Status")).toHaveValue("active");
  expect(await axeViolations(page)).toEqual([]);

  // Log a call.
  await page.getByLabel("What").selectOption("call");
  await page.getByLabel("Notes", { exact: true }).fill("Kick-off: agreed on the catalogue first.");
  await page.getByRole("button", { name: "Add to the log" }).click();
  await expect(page.getByText("Added to the log.")).toBeVisible();
  await expect(timeline.getByText("Kick-off: agreed on the catalogue first.")).toBeVisible();
});

test("tasks move across the board and up and down with the keyboard", async ({ page }) => {
  await page.goto(`/admin/projects/${await projectId()}/tasks`);
  const todo = page.locator("section", { has: page.getByRole("heading", { name: /^To do/ }) });
  const doing = page.locator("section", { has: page.getByRole("heading", { name: /^Doing/ }) });
  const addTodo = todo.getByLabel("Add a task to this column");
  for (const title of ["Wireframes", "Build pages", "Deploy"]) {
    await addTodo.fill(title);
    await addTodo.press("Enter");
    await expect(todo.locator("[data-card]", { hasText: title })).toBeVisible();
  }
  await expect(todo.locator("[data-card]")).toHaveText(["Wireframes", "Build pages", "Deploy"]);
  expect(await axeViolations(page)).toEqual([]);

  const wireframes = page.locator("[data-card]", { hasText: "Wireframes" });
  await wireframes.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(doing.locator("[data-card]")).toHaveText(["Wireframes"]);
  await expect(wireframes).toBeFocused();
  await expect(page.getByText("Moved “Wireframes” to Doing, position 1 of 1.")).toBeAttached();

  await page.locator("[data-card]", { hasText: "Deploy" }).focus();
  await page.keyboard.press("Shift+ArrowUp");
  await expect(todo.locator("[data-card]")).toHaveText(["Deploy", "Build pages"]);

  // Plain arrows only move the focus.
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("[data-card]", { hasText: "Build pages" })).toBeFocused();

  await page.reload();
  await expect(todo.locator("[data-card]")).toHaveText(["Deploy", "Build pages"]);
  await expect(doing.locator("[data-card]")).toHaveText(["Wireframes"]);
  const statuses = await withDb((db) =>
    db
      .collection("tasks")
      .find({}, { projection: { title: 1, status: 1 } })
      .toArray(),
  );
  expect(Object.fromEntries(statuses.map((task) => [task.title, task.status]))).toEqual({
    Wireframes: "doing",
    "Build pages": "todo",
    Deploy: "todo",
  });
});

test("the project board moves a project to the next stage", async ({ page }) => {
  await page.goto("/admin/projects");
  const planned = page.locator("section", { has: page.getByRole("heading", { name: /^Planned/ }) });
  const active = page.locator("section", { has: page.getByRole("heading", { name: /^In progress/ }) });
  // Keys work once the page has hydrated: press again only while the card has not moved.
  await expect(async () => {
    if (await planned.locator("[data-card]", { hasText: "Shop rebuild" }).count()) {
      await page.locator("[data-card]", { hasText: "Shop rebuild" }).focus();
      await page.keyboard.press("Shift+ArrowRight");
    }
    await expect(active.locator("[data-card]", { hasText: "Shop rebuild" })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect
    .poll(() =>
      withDb((db) => db.collection("projects").findOne({ title: "Shop rebuild" })).then((p) => p?.stage),
    )
    .toBe("active");
  // The card moves before the server answers, and the page its answer re-renders (the <title> included) may
  // still be arriving: check until the page has settled.
  await expect.poll(() => axeViolations(page)).toEqual([]);
});

test("only one timer runs, and stopping it records the time", async ({ page }) => {
  await page.goto("/admin/time");
  const sidebar = page.locator("aside");
  await sidebar.getByRole("button", { name: "Start timer" }).click();
  await sidebar.getByLabel("What are you working on?").fill("Planning the catalogue");
  await sidebar.getByLabel("Project").selectOption({ label: "PRJ-001 · Shop rebuild" });
  await sidebar.getByRole("button", { name: "Start", exact: true }).click();
  await expect(sidebar.getByText(/Planning the catalogue · PRJ-001/)).toBeVisible();

  // Starting another one, from a task, replaces it.
  const task = await withDb((db) => db.collection("tasks").findOne({ title: "Wireframes" }));
  await page.goto(`/admin/tasks/${task!._id.toHexString()}`);
  await page.getByRole("main").getByRole("button", { name: "Start timer" }).click();
  await expect(page.getByRole("main").getByText("Timer running")).toBeVisible();
  await expect(sidebar.getByText(/^Wireframes · PRJ-001/)).toBeVisible();
  const running = await withDb((db) => db.collection("time_entries").find({ running: true }).toArray());
  expect(running).toHaveLength(1);
  expect(running[0]?.description).toBe("Wireframes");
  // The first timer ran for seconds, so it was dropped.
  expect(await withDb((db) => db.collection("time_entries").countDocuments())).toBe(1);

  // Five minutes later.
  await withDb((db) =>
    db
      .collection("time_entries")
      .updateOne({ running: true }, { $set: { startedAt: new Date(Date.now() - 5 * 60_000) } }),
  );
  await page.reload();
  await sidebar.getByRole("button", { name: "Stop" }).click();
  await expect(sidebar.getByText("Stopped: 5 min recorded.")).toBeVisible();
  expect(await withDb((db) => db.collection("time_entries").countDocuments({ running: true }))).toBe(0);

  await page.goto("/admin/time");
  await expect(page.getByRole("main").getByText("0:05").first()).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  // Time added by hand.
  await page.getByLabel("What").fill("Client call");
  await page.getByLabel("Project").selectOption({ label: "PRJ-001 · Shop rebuild" });
  await page.getByLabel("How long").fill("1:30");
  await page.getByRole("button", { name: "Add time" }).click();
  await expect(page.getByText("1 h 30 min added.")).toBeVisible();
  await expect(page.getByText("1.6 h", { exact: true })).toBeVisible(); // 1:35 this week
});

test("revision rounds count against the included ones", async ({ page }) => {
  await page.goto(`/admin/projects/${await projectId()}/revisions`);
  await expect(page.getByText("0 of 2 included rounds used")).toBeVisible();
  for (const [index, title] of ["Bigger logo", "New colours", "Extra page"].entries()) {
    await page.getByLabel("What they asked for").fill(title);
    await page.getByRole("button", { name: "Add round" }).click();
    await expect(page.getByText(new RegExp(`^Round ${index + 1} added\\.`))).toBeVisible();
  }
  await expect(page.getByText(/It is past the included rounds, so it is billable/)).toBeVisible();
  await expect(page.getByText("2 of 2 included rounds used, plus 1 extra")).toBeVisible();
  await expect(page.getByText("extra · $60")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  // Cancelling a round gives it back; the next one is included again.
  await page.getByLabel("Status of round 2").selectOption("cancelled");
  await expect(page.getByText(/Round cancelled/)).toBeVisible();
  await expect(page.getByText("2 of 2 included rounds used", { exact: true })).toBeVisible();

  await page.goto(`/admin/projects/${await projectId()}/tasks`);
  await expect(page.locator("[data-card]", { hasText: "Round 3: Extra page" })).toBeVisible();
});

test("the task lists tick tasks off and move a repeating one to its next date", async ({ page }) => {
  await page.goto("/admin/tasks?view=anytime");
  // Shortcuts work once the page has hydrated: keep pressing until one lands.
  await expect(async () => {
    await page.keyboard.press("n");
    await expect(page.getByLabel("New task")).toBeFocused({ timeout: 500 });
  }).toPass();
  await page.getByLabel("New task").fill("Send the weekly update");
  await page.getByLabel("When").selectOption("today");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Task added.")).toBeVisible();

  await page.goto("/admin/tasks");
  const row = page.getByRole("link", { name: "Send the weekly update" });
  await expect(row).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await row.click();
  await page.getByLabel("Repeat").selectOption("weekly");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Task saved.")).toBeVisible();
  await page.getByRole("button", { name: "Mark as done" }).click();
  await expect(page.getByText(/^Done\. It repeats on /)).toBeVisible();
  const repeated = await withDb((db) => db.collection("tasks").findOne({ title: "Send the weekly update" }));
  expect(repeated).toMatchObject({ status: "todo", timesCompleted: 1 });

  // x ticks the focused task off.
  await page.goto("/admin/tasks?view=anytime");
  const focused = page.locator("a[data-task]:focus");
  await expect(async () => {
    await page.keyboard.press("j");
    await expect(focused).toHaveCount(1, { timeout: 500 });
  }).toPass();
  const title = await focused.textContent();
  await page.keyboard.press("x");
  await expect(page.getByText("Done.", { exact: true })).toBeVisible();
  const done = await withDb((db) => db.collection("tasks").findOne({ title: title! }));
  expect(done?.status).toBe("done");
});

test("a client's data can be exported, and the client deleted with their work", async ({ page }) => {
  await page.goto("/admin/clients");
  await page.getByRole("link", { name: /Grace Hopper/ }).click();

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export data" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^client-grace-hopper-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(readFileSync((await download.path())!, "utf8")) as {
    client: { name: string };
    projects: unknown[];
    tasks: unknown[];
    messages: unknown[];
  };
  expect(data.client.name).toBe("Grace Hopper");
  expect(data.projects).toHaveLength(1);
  expect(data.messages).toHaveLength(1);

  await page.getByRole("button", { name: "Delete client…" }).click();
  await page.getByLabel("Type the client's name to confirm").fill("Grace");
  await page.getByRole("button", { name: "Delete for good" }).click();
  await expect(page.getByText("Type the client's name exactly as it is shown.")).toBeVisible();
  await page.getByLabel("Type the client's name to confirm").fill("Grace Hopper");
  await page.getByRole("button", { name: "Delete for good" }).click();
  await expect(page).toHaveURL(/\/admin\/clients$/);

  const left = await withDb(async (db) => ({
    clients: await db.collection("clients").countDocuments(),
    projects: await db.collection("projects").countDocuments(),
    projectTasks: await db.collection("tasks").countDocuments({ projectId: { $ne: null } }),
    time: await db.collection("time_entries").countDocuments(),
    message: await db.collection("inquiries").findOne({ email: SENDER }),
    audit: await db
      .collection("audit_log")
      .countDocuments({ action: { $in: ["clients.client.exported", "clients.client.deleted"] } }),
  }));
  expect(left).toMatchObject({ clients: 0, projects: 0, projectTasks: 0, time: 0, audit: 2 });
  expect(left.message?.clientId).toBeNull();
});
