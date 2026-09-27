import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as inviteFile } from "@/app/(public)/meeting/[token]/invite.ics/route";
import { GET as typeSlots } from "@/app/api/bookings/[slug]/slots/route";
import { POST as book } from "@/app/api/bookings/route";
import { POST as cancel } from "@/app/api/meetings/[token]/cancel/route";
import { POST as reschedule } from "@/app/api/meetings/[token]/reschedule/route";
import { GET as moveSlots } from "@/app/api/meetings/[token]/slots/route";
import { DEFAULT_AVAILABILITY } from "@/lib/booking/availability";
import {
  ownerApprove,
  ownerCreate,
  ownerDecline,
  ownerReschedule,
  sendReminders,
} from "@/server/calendar/booking";
import { bookingTypes, meetings, saveAvailability } from "@/server/calendar/settings";
import { createClient } from "@/server/clients/store";
import { resetClock, setClock } from "@/server/clock";
import { closeClient } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { readChannels } from "@/server/notify/channels";
import type { OutboxDoc } from "@/server/notify/outbox";
import { clientInput } from "../helpers/work";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

vi.mock("@/server/notify/kick", () => ({ sendQueuedSoon: vi.fn() }));
vi.mock("@/server/analytics/kick", () => ({ goalSoon: vi.fn() }));

const { db, url, name } = setupTestDb();
setupTestEnv({
  MONGO_URL: url,
  DB_NAME: name,
  EMAIL_DELIVERY: "log",
  NOTIFY_EMAIL_TO: "owner@leffloard.test",
});

// Monday 28 September 2026, 09:00 in Istanbul. Mondays 17:00-19:00 there (14:00-16:00 UTC).
const NOW = new Date("2026-09-28T06:00:00Z");
const SLOT = "2026-09-28T14:00:00.000Z";

beforeEach(async () => {
  await runMigrations(db());
  setClock(() => NOW);
  await saveAvailability(
    db(),
    {
      ...DEFAULT_AVAILABILITY,
      weekly: [[{ start: "17:00", end: "19:00" }], [], [], [], [], [], []],
      minNoticeMinutes: 60,
      horizonDays: 14,
      bufferMinutes: 0,
      dailyCap: 0,
    },
    0,
    NOW,
  );
});

afterEach(() => resetClock());

afterAll(async () => {
  await closeClient();
});

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://leffloard.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.9",
      origin: "https://leffloard.test",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const get = (path: string) => new Request(`https://leffloard.test${path}`);

async function introQuestion(): Promise<string> {
  const type = await bookingTypes(db()).findOne({ slug: "intro-call" });
  return type!.questions[0]!.id;
}

async function booking(overrides: Record<string, unknown> = {}) {
  return {
    type: "intro-call",
    start: SLOT,
    timeZone: "Europe/London",
    name: "Ada Lovelace",
    email: "ada@example.com",
    notes: "Looking forward to it.",
    answers: { [await introQuestion()]: "A shop for engines." },
    website: "",
    turnstileToken: "",
    ...overrides,
  };
}

const outbox = () => db().collection<OutboxDoc>("outbox").find().sort({ createdAt: 1, _id: 1 }).toArray();
const tokenOf = (manageUrl: string) => manageUrl.replace("/meeting/", "");

describe("booking a call", () => {
  it("lists open times, books one, and tells both sides", async () => {
    const listed = await typeSlots(get("/api/bookings/intro-call/slots"), {
      params: Promise.resolve({ slug: "intro-call" }),
    });
    const slots = (await listed.json()) as { slots: string[]; durationMinutes: number };
    expect(slots.durationMinutes).toBe(30);
    expect(slots.slots.slice(0, 4)).toEqual([
      "2026-09-28T14:00:00.000Z",
      "2026-09-28T14:30:00.000Z",
      "2026-09-28T15:00:00.000Z",
      "2026-09-28T15:30:00.000Z",
    ]);

    const response = await book(post("/api/bookings", await booking()));
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      status: string;
      manageUrl: string;
      start: string;
      location: string;
    };
    expect(body).toMatchObject({ status: "confirmed", start: SLOT });
    expect(body.manageUrl).toMatch(/^\/meeting\/[A-Za-z0-9_-]{43}$/);
    expect(body.location).toMatch(/^https:\/\/meet\.jit\.si\//);

    const stored = await meetings(db()).findOne({ email: "ada@example.com" });
    expect(stored).toMatchObject({
      status: "confirmed",
      timeZone: "Europe/London",
      answers: [{ label: "What would you like to build?", value: "A shop for engines." }],
    });

    const sent = await outbox();
    expect(sent.map((item) => [item.channel, item.label])).toEqual([
      ["email", "Booked email to Ada Lovelace"],
      ["email", "Booked alert for Intro call with Ada Lovelace"],
    ]);
    const guestEmail = sent[0]!.payload as {
      subject: string;
      text: string;
      calendar?: { method: string; content: string };
    };
    // 15:00 in London that Monday.
    expect(guestEmail.subject).toBe("Booked: Intro call, Mon 28 Sep, 15:00");
    expect(guestEmail.text).toContain(`https://leffloard.test${body.manageUrl}`);
    expect(guestEmail.calendar?.method).toBe("REQUEST");
    expect(guestEmail.calendar?.content).toContain("DTSTART:20260928T140000Z");
    expect(guestEmail.calendar?.content).toContain("ORGANIZER;CN=");

    // The same time again is gone, and the answer brings the fresh list.
    const again = await book(post("/api/bookings", await booking({ email: "grace@example.com" })));
    expect(again.status).toBe(409);
    const refused = (await again.json()) as { problem: string; slots: string[] };
    expect(refused.problem).toBe("unavailable");
    expect(refused.slots).not.toContain(SLOT);
  });

  it("checks the form like the browser does", async () => {
    const response = await book(
      post("/api/bookings", await booking({ name: " ", email: "nope", answers: {} })),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { errors: Record<string, string> };
    expect(body.errors).toMatchObject({
      name: "Tell me your name.",
      email: "Enter a valid email address.",
      [`answers.${await introQuestion()}`]: "Please answer this.",
    });
    expect((await book(post("/api/bookings", await booking({ start: "2026-09-28T14:05:00Z" })))).status).toBe(
      422,
    );
    expect((await book(post("/api/bookings", await booking({ type: "nope" })))).status).toBe(404);
    // Outside the hours, or too soon.
    expect((await book(post("/api/bookings", await booking({ start: "2026-09-28T12:00:00Z" })))).status).toBe(
      409,
    );
    expect((await book(post("/api/bookings", await booking({ start: "2026-09-28T06:30:00Z" })))).status).toBe(
      409,
    );
    expect(await meetings(db()).countDocuments()).toBe(0);
  });

  it("refuses cross-site posts, fools bots, replays duplicates and slows floods", async () => {
    const crossSite = await book(
      post("/api/bookings", await booking(), {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      }),
    );
    expect(crossSite.status).toBe(403);

    const bot = await book(post("/api/bookings", await booking({ website: "http://spam.example" })));
    expect(bot.status).toBe(201);
    expect(await meetings(db()).countDocuments()).toBe(0);

    const key = { "idempotency-key": "c8a3b0e4-4a1f-4c55-9b0a-0f7c1c2d3e4f" };
    const first = await book(post("/api/bookings", await booking(), key));
    const second = await book(post("/api/bookings", await booking(), key));
    expect([first.status, second.status]).toEqual([201, 201]);
    const firstUrl = ((await first.json()) as { manageUrl: string }).manageUrl;
    expect(((await second.json()) as { manageUrl: string }).manageUrl).toBe(firstUrl);
    expect(await meetings(db()).countDocuments()).toBe(1);
    // The answer kept for replays names the meeting, never its link's secret.
    const kept = JSON.stringify(await db().collection("idempotency_keys").find().toArray());
    expect(kept).toContain("meetingId");
    expect(kept).not.toContain(tokenOf(firstUrl));

    const statuses: number[] = [];
    for (const start of ["14:30", "15:00", "15:30", "14:30", "15:00"]) {
      statuses.push(
        (
          await book(
            post(
              "/api/bookings",
              await booking({ start: `2026-09-28T${start}:00.000Z`, email: "x@example.com" }),
            ),
          )
        ).status,
      );
    }
    expect(statuses.at(-1)).toBe(429);
  });

  it("books a secret type only with its link's key", async () => {
    const secret = (await bookingTypes(db()).findOne({ slug: "project-check-in" }))!;
    const question = secret.questions[0]!.id;
    const details = await booking({
      type: "project-check-in",
      answers: { [question]: "The shop's checkout." },
    });
    expect((await book(post("/api/bookings", details))).status).toBe(404);
    expect((await book(post("/api/bookings", { ...details, key: "not-the-key-000000000" }))).status).toBe(
      404,
    );
    const listed = (slug: string, query = "") =>
      typeSlots(get(`/api/bookings/${slug}/slots${query}`), { params: Promise.resolve({ slug }) });
    expect((await listed("project-check-in")).status).toBe(404);
    expect((await listed("project-check-in", `?key=${secret.linkKey}`)).status).toBe(200);
    const response = await book(post("/api/bookings", { ...details, key: secret.linkKey }));
    expect(response.status).toBe(201);
    expect((await meetings(db()).findOne())?.title).toBe("Project check-in");
  });

  it("links the booking to a known client", async () => {
    const client = await createClient(db(), clientInput({ email: "ada@example.com" }), {}, NOW);
    await book(post("/api/bookings", await booking()));
    expect((await meetings(db()).findOne())?.clientId?.equals(client._id)).toBe(true);
  });

  it("holds a request until the owner confirms it", async () => {
    await bookingTypes(db()).updateOne({ slug: "intro-call" }, { $set: { requiresApproval: true } });
    const response = await book(post("/api/bookings", await booking()));
    expect((await response.json()).status).toBe("requested");
    const labels = (await outbox()).map((item) => item.label);
    expect(labels).toEqual([
      "Requested email to Ada Lovelace",
      "Requested alert for Intro call with Ada Lovelace",
    ]);
    const meeting = (await meetings(db()).findOne())!;
    await ownerApprove(db(), meeting._id, { siteUrl: "https://leffloard.test", channels: readChannels() });
    const booked = (await outbox()).at(-1)!;
    expect(booked.label).toBe("Booked email to Ada Lovelace");
    // The confirmed invite outranks the tentative one the guest may have added.
    expect((booked.payload as { calendar: { content: string } }).calendar.content).toContain("SEQUENCE:1");
  });

  it("keeps a request tentative until it is answered, and takes it back when declined", async () => {
    await bookingTypes(db()).updateOne({ slug: "intro-call" }, { $set: { requiresApproval: true } });
    const response = await book(post("/api/bookings", await booking()));
    const token = tokenOf(((await response.json()) as { manageUrl: string }).manageUrl);
    const params = { params: Promise.resolve({ token }) };
    expect(await (await inviteFile(get(`/meeting/${token}/invite.ics`), params)).text()).toContain(
      "STATUS:TENTATIVE",
    );

    // Moved by the owner, it is still a request: no invite yet.
    const notify = { siteUrl: "https://leffloard.test", channels: readChannels() };
    const meeting = (await meetings(db()).findOne())!;
    const moved = await ownerReschedule(db(), meeting._id, new Date("2026-09-28T15:00:00Z"), notify, {
      tellGuest: true,
    });
    expect(moved.ok).toBe(true);
    const proposal = (await outbox()).at(-1)!.payload as { subject: string; calendar?: unknown };
    expect(proposal.subject).toBe("New time proposed: Intro call, Mon 28 Sep, 16:00");
    expect(proposal.calendar).toBeUndefined();

    await ownerDecline(db(), meeting._id, null, notify);
    const declined = (await outbox()).at(-1)!.payload as { subject: string; calendar: { method: string } };
    expect(declined.subject).toBe("Not possible: Intro call, Mon 28 Sep, 16:00");
    expect(declined.calendar.method).toBe("CANCEL");
  });
});

describe("the guest's link", () => {
  async function booked(): Promise<string> {
    const response = await book(post("/api/bookings", await booking()));
    return tokenOf(((await response.json()) as { manageUrl: string }).manageUrl);
  }

  it("moves the meeting and sends the updated invite", async () => {
    const token = await booked();
    const params = { params: Promise.resolve({ token }) };
    const open = (await (await moveSlots(get(`/api/meetings/${token}/slots`), params)).json()) as {
      slots: string[];
    };
    expect(open.slots).toContain(SLOT); // its own time counts as free

    const moved = await reschedule(
      post(`/api/meetings/${token}/reschedule`, { start: "2026-09-28T15:30:00.000Z" }),
      params,
    );
    expect(moved.status).toBe(200);
    expect(await moved.json()).toMatchObject({
      start: "2026-09-28T15:30:00.000Z",
      end: "2026-09-28T16:00:00.000Z",
    });
    const email = (await outbox()).find((item) => item.label.startsWith("Rescheduled email"))!;
    const payload = email.payload as { subject: string; calendar: { content: string } };
    expect(payload.subject).toBe("New time: Intro call, Mon 28 Sep, 16:30");
    expect(payload.calendar.content).toContain("SEQUENCE:1");

    const file = await inviteFile(get(`/meeting/${token}/invite.ics`), params);
    expect(file.headers.get("content-type")).toContain("text/calendar");
    expect(await file.text()).toContain("DTSTART:20260928T153000Z");
  });

  it("cancels once, with a CANCEL invite, and then can't change it", async () => {
    const token = await booked();
    const params = { params: Promise.resolve({ token }) };
    const cancelled = await cancel(
      post(`/api/meetings/${token}/cancel`, { reason: "Something came up." }),
      params,
    );
    expect(cancelled.status).toBe(200);
    const stored = await meetings(db()).findOne();
    expect(stored).toMatchObject({
      status: "cancelled",
      cancelledBy: "guest",
      cancelReason: "Something came up.",
    });
    const email = (await outbox()).find((item) => item.label.startsWith("Cancelled email"))!;
    expect((email.payload as { calendar: { method: string } }).calendar.method).toBe("CANCEL");
    expect((await outbox()).some((item) => item.label.startsWith("Cancelled alert"))).toBe(true);

    expect((await cancel(post(`/api/meetings/${token}/cancel`, {}), params)).status).toBe(409);
    expect(
      (await reschedule(post(`/api/meetings/${token}/reschedule`, { start: SLOT }), params)).status,
    ).toBe(409);
    expect((await moveSlots(get(`/api/meetings/${token}/slots`), params)).status).toBe(409);
    // The time is free again.
    expect((await book(post("/api/bookings", await booking({ email: "grace@example.com" })))).status).toBe(
      201,
    );
  });

  it("refuses links that don't exist", async () => {
    const params = { params: Promise.resolve({ token: "x".repeat(43) }) };
    expect((await cancel(post("/api/meetings/x/cancel", {}), params)).status).toBe(404);
    expect((await inviteFile(get("/meeting/x/invite.ics"), params)).status).toBe(404);
  });
});

describe("reminders", () => {
  it("reminds confirmed guests about a day before, once", async () => {
    await book(post("/api/bookings", await booking({ start: "2026-10-05T14:00:00.000Z" })));
    const notify = { siteUrl: "https://leffloard.test", channels: readChannels() };
    // Two days before: not yet.
    expect(await sendReminders(db(), notify, new Date("2026-10-03T14:00:00Z"))).toBe(0);
    // 20 hours before.
    expect(await sendReminders(db(), notify, new Date("2026-10-04T18:00:00Z"))).toBe(1);
    expect(await sendReminders(db(), notify, new Date("2026-10-04T18:10:00Z"))).toBe(0);
    const reminder = (await outbox()).find((item) => item.label.startsWith("Reminder email"))!;
    expect((reminder.payload as { subject: string }).subject).toBe("Tomorrow: Intro call, Mon 5 Oct, 15:00");
  });

  it("waits 12 hours after a booking, and never reminds a guest the owner chose not to email", async () => {
    const notify = { siteUrl: "https://leffloard.test", channels: readChannels() };
    // Booked on Sunday evening for Monday afternoon, 22 hours ahead.
    setClock(() => new Date("2026-10-04T16:00:00Z"));
    expect(
      (await book(post("/api/bookings", await booking({ start: "2026-10-05T14:00:00.000Z" })))).status,
    ).toBe(201);
    expect(await sendReminders(db(), notify, new Date("2026-10-04T16:10:00Z"))).toBe(0);
    expect(await sendReminders(db(), notify, new Date("2026-10-05T04:00:00Z"))).toBe(1);
    const reminder = (await outbox()).find((item) => item.label.startsWith("Reminder email"))!;
    expect((reminder.payload as { subject: string }).subject).toBe("Today: Intro call, Mon 5 Oct, 15:00");

    const quiet = await ownerCreate(
      db(),
      {
        title: "Project call",
        startsAt: new Date("2026-10-07T09:00:00Z"),
        durationMinutes: 30,
        timeZone: "Europe/Istanbul",
        name: "Grace Hopper",
        email: "grace@example.com",
        location: "jitsi",
        locationDetails: "",
        clientId: null,
        ownerNote: "",
        tellGuest: false,
      },
      notify,
      new Date("2026-10-04T16:00:00Z"),
    );
    expect(quiet.ok).toBe(true);
    expect(await sendReminders(db(), notify, new Date("2026-10-06T12:00:00Z"))).toBe(0);
    expect((await outbox()).filter((item) => item.label.includes("Grace Hopper"))).toEqual([]);
  });
});
