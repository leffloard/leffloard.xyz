import type { Db, ObjectId } from "mongodb";
import { axeViolations, signInOwner, withDb } from "./helpers";
import { expect, test, watchPage } from "./test";

// Booking a call as a visitor in another time zone, the double-booking guard, the guest's own link, a
// request the owner confirms, and the owner's side: a meeting, a block, the hours and the feed. Runs after
// the other admin modules (see playwright.config.ts), one step after another.

test.describe.configure({ mode: "serial" });
test.use({ timezoneId: "Europe/London" });

const OWNER_ZONE = "Europe/Istanbul";

// "15:30" for an instant, in a zone.
function wallTime(instant: string, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}

// "2026-10-01" for an instant, in a zone.
function wallDate(instant: Date | string, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date(instant));
}

type MeetingRow = {
  _id: ObjectId;
  email: string;
  startsAt: Date;
  timeZone: string;
  status: string;
  sequence: number;
  cancelledBy: string | null;
  location: { url: string | null };
};

async function meetingOf(email: string): Promise<MeetingRow> {
  const meeting = await withDb((db) => db.collection<MeetingRow>("meetings").findOne({ email }));
  if (!meeting) throw new Error(`No meeting for ${email}.`);
  return meeting;
}

type EmailRow = {
  payload: { subject: string; text: string; calendar?: { method: string; content: string } };
};

async function emailFor(meeting: MeetingRow, event: string): Promise<EmailRow | null> {
  return withDb((db) =>
    db.collection<EmailRow>("outbox").findOne({ dedupeKey: `meeting:${meeting._id.toHexString()}:${event}` }),
  );
}

// Every hour of every day is bookable from two hours ahead, so the tests find open times whenever they run.
async function resetCalendar(db: Db): Promise<void> {
  for (const name of ["meetings", "slot_locks", "booking_days", "calendar_blocks"]) {
    await db.collection(name).deleteMany({});
  }
  await db.collection("outbox").deleteMany({ dedupeKey: { $regex: "^meeting:" } });
  await db.collection<{ _id: string }>("settings").updateOne(
    { _id: "calendar" },
    {
      $set: {
        timeZone: OWNER_ZONE,
        weekly: Array.from({ length: 7 }, () => [{ start: "00:00", end: "24:00" }]),
        overrides: [],
        bufferMinutes: 15,
        minNoticeMinutes: 120,
        horizonDays: 14,
        dailyCap: 0,
        stepMinutes: 30,
        feedTokenHash: null,
        updatedAt: new Date(),
        version: 1,
      },
    },
    { upsert: true },
  );
  await db.collection("booking_types").deleteMany({ slug: { $nin: ["intro-call", "project-check-in"] } });
  await db.collection("booking_types").updateMany({}, { $set: { requiresApproval: false, active: true } });
  await db
    .collection<{ _id: string }>("rate_limits")
    .deleteMany({ _id: { $regex: "^(booking|manage|slots):" } });
}

let manageUrl = "";

test.beforeAll(async () => {
  await withDb(resetCalendar);
});

test("a visitor in London books a call in their own time", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/book");
  await page.getByRole("link", { name: /Intro call/ }).click();
  await expect(page).toHaveURL(/\/book\/intro-call$/);
  await expect(page.getByLabel("Times shown in")).toHaveValue("Europe/London");

  const first = page
    .getByRole("group", { name: /^Times on / })
    .getByRole("button")
    .first();
  const slot = (await first.getAttribute("data-slot"))!;
  await expect(first).toHaveText(wallTime(slot, "Europe/London"));
  expect(await axeViolations(page)).toEqual([]);

  await first.click();
  await expect(
    page.getByRole("heading", { name: new RegExp(`, ${wallTime(slot, "Europe/London")}`) }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Book this time" }).click();
  await expect(page.getByText("Tell me your name.")).toBeVisible();
  await page.getByLabel("Your name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("What would you like to build?").fill("A booking page for my bakery.");
  await page.getByRole("button", { name: "Book this time" }).click();
  await expect(
    page.getByRole("heading", {
      name: new RegExp(`^Booked\\. \\w{3} \\d{1,2} \\w{3}, ${wallTime(slot, "Europe/London")}$`),
    }),
  ).toBeVisible();
  await expect(page.getByText("Times are in Europe/London.")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  const meeting = await meetingOf("ada@example.com");
  expect(meeting.startsAt.toISOString()).toBe(slot);
  expect(meeting.timeZone).toBe("Europe/London");
  expect(meeting.status).toBe("confirmed");
  expect(meeting.location.url).toMatch(/^https:\/\/meet\.jit\.si\/leffloard-[0-9a-f]{20}$/);

  // The confirmation carries the calendar invite and the guest's own link.
  const email = await emailFor(meeting, "booked");
  expect(email?.payload.calendar?.method).toBe("REQUEST");
  expect(email?.payload.calendar?.content).toContain(`UID:${meeting._id.toHexString()}@localhost`);
  expect(email?.payload.text).toContain("/meeting/");

  manageUrl = (await page.getByRole("link", { name: "Reschedule or cancel" }).getAttribute("href"))!;
  expect(manageUrl).toMatch(/\/meeting\/[A-Za-z0-9_-]{43}$/);
  const invite = await page.request.get(`${manageUrl}/invite.ics`);
  expect(invite.headers()["content-type"]).toContain("text/calendar");
  expect(await invite.text()).toContain("BEGIN:VEVENT");
});

test("a time can be booked only once", async ({ page, browser }) => {
  const other = await browser.newContext({ timezoneId: "Europe/London" });
  const second = await other.newPage();
  const secondErrors: string[] = [];
  watchPage(second, secondErrors);

  await page.goto("/book/intro-call");
  await second.goto("/book/intro-call");
  const slot = await page
    .getByRole("group", { name: /^Times on / })
    .getByRole("button")
    .first()
    .getAttribute("data-slot");
  for (const [tab, name, email] of [
    [page, "Grace Hopper", "grace@example.com"],
    [second, "Alan Turing", "alan@example.com"],
  ] as const) {
    await tab.locator(`[data-slot="${slot}"]`).click();
    await tab.getByLabel("Your name").fill(name);
    await tab.getByLabel("Email").fill(email);
    await tab.getByLabel("What would you like to build?").fill("An online shop.");
  }

  await page.getByRole("button", { name: "Book this time" }).click();
  await expect(page.getByRole("heading", { name: /^Booked\./ })).toBeVisible();
  await second.getByRole("button", { name: "Book this time" }).click();
  // The time is no longer offered, so the second booking is turned away before it gets near the database
  // (bookings racing for the same time are refused there too: tests/integration/calendar.test.ts).
  await expect(second.getByText("That time is no longer available. Pick another one.")).toBeVisible();
  // Back at the times, without the one that was taken.
  await expect(second.getByRole("heading", { name: "Pick a time" })).toBeVisible();
  await expect(second.locator(`[data-slot="${slot}"]`)).toHaveCount(0);
  expect(secondErrors.filter((error) => !/409/.test(error))).toEqual([]);
  await other.close();

  const booked = await withDb((db) =>
    db
      .collection("meetings")
      .find({ startsAt: new Date(slot!) })
      .toArray(),
  );
  expect(booked.map((meeting) => meeting.email)).toEqual(["grace@example.com"]);
});

test("the guest moves and then cancels the call from their link", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(manageUrl);
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Times shown in")).toHaveValue("Europe/London");
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("button", { name: "Reschedule" }).click();
  await expect(page.getByRole("heading", { name: "Pick a new time" })).toBeVisible();
  const target = page
    .getByRole("group", { name: /^Times on / })
    .getByRole("button")
    .last();
  const newSlot = (await target.getAttribute("data-slot"))!;
  await target.click();
  await expect(page.getByText("Moved. An email with the new time is on its way.")).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: new RegExp(`, ${wallTime(newSlot, "Europe/London")}$`) }),
  ).toBeVisible();
  const moved = await meetingOf("ada@example.com");
  expect(moved.startsAt.toISOString()).toBe(newSlot);
  expect(moved.sequence).toBe(1);
  const update = await emailFor(moved, "rescheduled:1");
  expect(update?.payload.calendar?.method).toBe("REQUEST");
  expect(update?.payload.calendar?.content).toContain("SEQUENCE:1");
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByLabel("Reason").fill("I found a slot with a colleague.");
  await page.getByRole("button", { name: "Cancel the meeting" }).click();
  await expect(page.getByText("Cancelled. You'll get an email to confirm it.")).toBeVisible();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reschedule" })).toHaveCount(0);

  const cancelled = await meetingOf("ada@example.com");
  expect(cancelled.status).toBe("cancelled");
  expect(cancelled.cancelledBy).toBe("guest");
  expect(await withDb((db) => db.collection("slot_locks").countDocuments({ meetingId: cancelled._id }))).toBe(
    0,
  );
  expect((await emailFor(cancelled, "cancelled"))?.payload.calendar?.method).toBe("CANCEL");
});

test("a request waits for the owner, who confirms it", async ({ page, browser }) => {
  await signInOwner(page.context());
  await page.goto("/admin/calendar/types");
  const type = page.locator("section", { has: page.getByRole("heading", { name: "Project check-in" }) });
  await type.getByLabel("I confirm each booking first").check();
  await type.getByRole("button", { name: "Save", exact: true }).click();
  await expect(type.getByText("Saved.")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  // A secret type's link carries its key; the address alone finds nothing.
  const link = (await type
    .getByRole("link", { name: /\/book\/project-check-in\?key=/ })
    .getAttribute("href"))!;
  expect(link).toMatch(/\/book\/project-check-in\?key=[A-Za-z0-9_-]{22}$/);
  const bare = await page.request.get("/book/project-check-in");
  expect(bare.status()).toBe(404);

  // A client in New York, with the type's link.
  const guest = await browser.newContext({ timezoneId: "America/New_York" });
  const tab = await guest.newPage();
  const guestErrors: string[] = [];
  watchPage(tab, guestErrors);
  await tab.goto(link);
  await expect(tab.getByLabel("Times shown in")).toHaveValue("America/New_York");
  await tab
    .getByRole("group", { name: /^Times on / })
    .getByRole("button")
    .first()
    .click();
  await tab.getByLabel("Your name").fill("Katherine Johnson");
  await tab.getByLabel("Email").fill("katherine@example.com");
  await tab.getByLabel("Which project, and what should we cover?").fill("The orbit calculator: next steps.");
  await tab.getByRole("button", { name: "Request this time" }).click();
  await expect(tab.getByRole("heading", { name: /^Request sent\./ })).toBeVisible();
  expect(guestErrors).toEqual([]);
  await guest.close();
  const request = await meetingOf("katherine@example.com");
  expect(request.status).toBe("requested");
  expect(request.timeZone).toBe("America/New_York");
  expect((await emailFor(request, "requested"))?.payload.calendar).toBeUndefined();

  await page.goto("/admin");
  await expect(page.getByRole("link", { name: /^Calendar\s*1\s*waiting for an answer$/ })).toBeVisible();
  const agenda = page.locator("section", {
    has: page.getByRole("heading", { name: "Meetings", exact: true }),
  });
  await expect(agenda.getByText("1 request waiting for your answer.")).toBeVisible();
  await expect(agenda.getByRole("link", { name: /Katherine Johnson/ })).toBeVisible();

  await page.goto("/admin/calendar");
  const waiting = page.locator("section", {
    has: page.getByRole("heading", { name: "Waiting for your answer" }),
  });
  await expect(waiting.getByText("Katherine Johnson")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  await waiting.getByRole("button", { name: "Confirm" }).click();
  await expect(waiting).toHaveCount(0);

  const confirmed = await meetingOf("katherine@example.com");
  expect(confirmed.status).toBe("confirmed");
  expect((await emailFor(confirmed, "booked"))?.payload.calendar?.method).toBe("REQUEST");
  await page.goto(`/admin/calendar/meetings/${confirmed._id.toHexString()}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Project check-in: Katherine Johnson" }),
  ).toBeVisible();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test("the owner adds a meeting and a block, changes the hours and subscribes to the feed", async ({
  page,
  request,
}) => {
  await signInOwner(page.context());
  const tomorrow = wallDate(new Date(Date.now() + 86_400_000), OWNER_ZONE);
  const inThreeDays = wallDate(new Date(Date.now() + 3 * 86_400_000), OWNER_ZONE);

  await page.goto("/admin/calendar/new");
  expect(await axeViolations(page)).toEqual([]);
  await page.getByLabel("With", { exact: true }).fill("Margaret Hamilton");
  await page.getByLabel("Their email", { exact: true }).fill("margaret@example.com");
  await page.getByLabel("Day", { exact: true }).fill(tomorrow);
  await page.getByLabel("Time (your time zone)", { exact: true }).fill("09:00");
  await page.getByRole("button", { name: "Add meeting" }).click();
  await expect(page).toHaveURL(/\/admin\/calendar\/meetings\/[a-f0-9]{24}$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Project call: Margaret Hamilton" }),
  ).toBeVisible();
  const added = await meetingOf("margaret@example.com");
  expect(wallDate(added.startsAt, OWNER_ZONE)).toBe(tomorrow);
  expect(wallTime(added.startsAt.toISOString(), OWNER_ZONE)).toBe("09:00");
  expect((await emailFor(added, "booked"))?.payload.calendar?.method).toBe("REQUEST");

  // A whole day blocked: the booking page offers nothing on it any more.
  await page.goto("/admin/calendar");
  const blockForm = page.locator("section", { has: page.getByRole("heading", { name: "Block time" }) });
  await blockForm.getByLabel("What").fill("Maths exam");
  await blockForm.getByLabel("From").fill(inThreeDays);
  await blockForm.getByRole("button", { name: "Add block" }).click();
  await expect(blockForm.getByText("Block added. No one can book over it.")).toBeVisible();
  const open = (await (await request.get("/api/bookings/intro-call/slots")).json()) as { slots: string[] };
  expect(open.slots.length).toBeGreaterThan(0);
  expect(open.slots.filter((slot) => wallDate(slot, OWNER_ZONE) === inThreeDays)).toEqual([]);

  // Hours: saved twice in a row, so the second save uses the version from the first.
  await page.goto("/admin/calendar/availability");
  expect(await axeViolations(page)).toEqual([]);
  const settings = () =>
    withDb((db) => db.collection<{ _id: string; dailyCap: number }>("settings").findOne({ _id: "calendar" }));
  await page.getByLabel("Calls a day at most").fill("4");
  await page.getByRole("button", { name: "Save hours and rules" }).click();
  await expect.poll(async () => (await settings())?.dailyCap).toBe(4);
  await page.getByLabel("Calls a day at most").fill("0");
  await page.getByRole("button", { name: "Save hours and rules" }).click();
  await expect.poll(async () => (await settings())?.dailyCap).toBe(0);
  await expect(page.getByText("Hours saved. The booking pages show them at once.")).toBeVisible();

  // The feed: its address works until it is replaced or turned off.
  const feed = page.locator("section", { has: page.getByRole("heading", { name: "Calendar feed" }) });
  await feed.getByRole("button", { name: "Turn the feed on" }).click();
  const address = feed.locator("code");
  await expect(address).toContainText("/api/calendar/feed/");
  const first = (await address.textContent())!.trim();
  const calendar = await request.get(first);
  expect(calendar.status()).toBe(200);
  expect(calendar.headers()["content-type"]).toContain("text/calendar");
  const ics = await calendar.text();
  expect(ics).toContain("SUMMARY:Project call: Margaret Hamilton");
  expect(ics).toContain("SUMMARY:Project check-in: Katherine Johnson");
  expect(ics).toContain("SUMMARY:Maths exam");
  expect(ics).not.toContain("Ada Lovelace"); // cancelled

  await feed.getByRole("button", { name: "Make a new address" }).click();
  await expect(address).not.toHaveText(first);
  const second = (await address.textContent())!.trim();
  expect((await request.get(first)).status()).toBe(404);
  expect((await request.get(second)).status()).toBe(200);
  await feed.getByRole("button", { name: "Turn off" }).click();
  await expect(feed.getByRole("button", { name: "Turn the feed on" })).toBeVisible();
  expect((await request.get(second)).status()).toBe(404);
  expect(await axeViolations(page)).toEqual([]);
});
