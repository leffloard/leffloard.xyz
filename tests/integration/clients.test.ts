import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addActivity,
  clientChoices,
  clientTimeline,
  createClient,
  createClientFromInquiry,
  deleteClient,
  exportClient,
  findClientsByEmail,
  getClient,
  linkedInquiries,
  linkInquiry,
  linkToKnownClient,
  listClients,
  setClientStatus,
  unlinkInquiry,
  updateClient,
} from "@/server/clients/store";
import { resetClock, setClock } from "@/server/clock";
import { runMigrations } from "@/server/db/migrate";
import { submitInquiry } from "@/server/inquiries/intake";
import { getInquiry, insertInquiry } from "@/server/inquiries/store";
import { createProject, moveProject } from "@/server/projects/store";
import { addRevision } from "@/server/projects/revisions";
import { createTask } from "@/server/tasks/store";
import { addEntry, startTimer } from "@/server/time/store";
import { inquiryInput } from "../helpers/inquiry";
import { clientInput, projectInput } from "../helpers/work";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

setupTestEnv();
const { db } = setupTestDb();

beforeEach(async () => {
  await runMigrations(db());
});

afterEach(() => resetClock());

const T0 = new Date("2026-09-20T09:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

describe("clients", () => {
  it("creates, reads and edits a client, refusing a save over a newer change", async () => {
    const client = await createClient(db(), clientInput({ email: "Ada@Example.com" }), {}, T0);
    expect(client.emailKey).toBe("ada@example.com");
    expect(client.version).toBe(1);

    const saved = await updateClient(db(), client._id, 1, clientInput({ name: "Ada King" }), minutes(1));
    expect(saved.ok && saved.doc.name).toBe("Ada King");
    expect(saved.ok && saved.doc.version).toBe(2);

    // A second tab still has version 1.
    const stale = await updateClient(db(), client._id, 1, clientInput({ name: "Stale" }), minutes(2));
    expect(stale).toEqual({ ok: false, reason: "conflict" });
    expect((await getClient(db(), client._id))?.name).toBe("Ada King");

    expect(await updateClient(db(), new ObjectId(), 1, clientInput(), minutes(3))).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("lists by status with counts, searches, and counts open projects", async () => {
    const ada = await createClient(db(), clientInput(), {}, T0);
    const grace = await createClient(
      db(),
      clientInput({ name: "Grace Hopper", email: "grace@navy.example", company: "US Navy" }),
      {},
      minutes(1),
    );
    const old = await createClient(
      db(),
      clientInput({ name: "Old Client", email: "old@example.com", status: "archived" }),
      {},
      minutes(2),
    );
    await createProject(db(), projectInput(grace._id), {}, minutes(3));
    await createProject(
      db(),
      projectInput(grace._id, { title: "Done thing" }),
      { stage: "delivered" },
      minutes(4),
    );

    const all = await listClients(db(), { view: "all", q: null, page: 1, limit: 25 });
    expect(all.items.map((item) => item.name)).toEqual(["Grace Hopper", "Ada Lovelace"]);
    expect(all.items[0]?.status).toBe("active"); // a project started
    expect(all.items[0]?.openProjects).toBe(1);
    expect(all.counts).toMatchObject({ all: 2, lead: 1, active: 1, archived: 1 });

    const archived = await listClients(db(), { view: "archived", q: null, page: 1, limit: 25 });
    expect(archived.items.map((item) => item._id.toHexString())).toEqual([old._id.toHexString()]);

    const search = await listClients(db(), { view: "all", q: "navy", page: 1, limit: 25 });
    expect(search.items.map((item) => item.name)).toEqual(["Grace Hopper"]);
    expect((await listClients(db(), { view: "all", q: "(", page: 1, limit: 25 })).items).toEqual([]);

    const choices = await clientChoices(db());
    expect(choices.map((choice) => choice.name)).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect((await findClientsByEmail(db(), "ADA@example.com")).map((c) => c._id.toHexString())).toEqual([
      ada._id.toHexString(),
    ]);
  });

  it("moves last contact only for calls, emails and meetings", async () => {
    const client = await createClient(db(), clientInput(), {}, T0);
    await addActivity(db(), {
      clientId: client._id,
      projectId: null,
      kind: "note",
      body: "Likes blue",
      at: minutes(5),
    });
    expect((await getClient(db(), client._id))?.lastContactAt).toBeNull();
    await addActivity(db(), {
      clientId: client._id,
      projectId: null,
      kind: "call",
      body: "Kickoff",
      at: minutes(10),
    });
    await addActivity(db(), {
      clientId: client._id,
      projectId: null,
      kind: "email",
      body: "Old",
      at: minutes(7),
    });
    expect((await getClient(db(), client._id))?.lastContactAt).toEqual(minutes(10));
    expect(
      await addActivity(db(), { clientId: new ObjectId(), projectId: null, kind: "note", body: "x", at: T0 }),
    ).toBeNull();
  });

  it("marks a lead or past client active when a project starts, but not an archived one", async () => {
    const past = await createClient(db(), clientInput({ status: "past" }), {}, T0);
    const archived = await createClient(db(), clientInput({ status: "archived" }), {}, T0);
    await createProject(db(), projectInput(past._id), {}, minutes(1));
    await createProject(db(), projectInput(archived._id), {}, minutes(1));
    expect((await getClient(db(), past._id))?.status).toBe("active");
    expect((await getClient(db(), archived._id))?.status).toBe("archived");
    await setClientStatus(db(), past._id, "past", minutes(2));
    expect((await getClient(db(), past._id))?.status).toBe("past");
  });
});

describe("clients and inbox messages", () => {
  it("creates a client from a message and links every message from that address, spam aside", async () => {
    const first = await insertInquiry(
      db(),
      inquiryInput({
        name: "Grace Hopper",
        email: "grace@navy.example",
        company: "US Navy",
        contact: "grace#1906",
        kind: "call",
        call: { timeZone: "America/New_York", date: "2026-10-01", time: "10:00", duration: 30 },
      }),
      { source: "form", receivedAt: T0 },
    );
    const second = await insertInquiry(db(), inquiryInput({ email: "GRACE@navy.example" }), {
      source: "form",
      receivedAt: minutes(30),
    });
    const spam = await insertInquiry(db(), inquiryInput({ email: "grace@navy.example" }), {
      source: "form",
      status: "spam",
      receivedAt: minutes(40),
    });
    const other = await insertInquiry(db(), inquiryInput({ email: "someone@else.example" }), {
      source: "form",
      receivedAt: minutes(50),
    });

    const client = await createClientFromInquiry(db(), first, minutes(60));
    expect(client).toMatchObject({
      name: "Grace Hopper",
      company: "US Navy",
      email: "grace@navy.example",
      timeZone: "America/New_York",
      status: "lead",
      notes: "Other contact: grace#1906",
      source: "Contact form",
    });
    expect(client.inquiryId?.equals(first._id)).toBe(true);
    expect((await getInquiry(db(), first._id))?.clientId?.equals(client._id)).toBe(true);
    expect((await getInquiry(db(), second._id))?.clientId?.equals(client._id)).toBe(true);
    expect((await getInquiry(db(), spam._id))?.clientId).toBeUndefined();
    expect((await getInquiry(db(), other._id))?.clientId).toBeUndefined();
    expect((await getClient(db(), client._id))?.lastContactAt).toEqual(minutes(30));
    expect((await linkedInquiries(db(), client._id)).map((m) => m.ref)).toEqual([second.ref, first.ref]);

    expect(await linkInquiry(db(), other._id, client._id, minutes(70))).not.toBeNull();
    expect((await getClient(db(), client._id))?.lastContactAt).toEqual(minutes(50));
    expect(await unlinkInquiry(db(), other._id)).toBe(true);
    expect((await getInquiry(db(), other._id))?.clientId).toBeNull();
    expect(await linkInquiry(db(), other._id, new ObjectId())).toBeNull();
  });

  it("links a new message to the one client with that address, and leaves ties and spam alone", async () => {
    const client = await createClient(db(), clientInput({ email: "ada@example.com" }), {}, T0);
    const message = await insertInquiry(db(), inquiryInput({ email: "Ada@Example.com" }), {
      source: "form",
      receivedAt: minutes(5),
    });
    expect((await linkToKnownClient(db(), message))?.equals(client._id)).toBe(true);
    expect((await getClient(db(), client._id))?.lastContactAt).toEqual(minutes(5));

    const spam = await insertInquiry(db(), inquiryInput({ email: "ada@example.com" }), {
      source: "form",
      status: "spam",
    });
    expect(await linkToKnownClient(db(), spam)).toBeNull();

    await createClient(db(), clientInput({ email: "ada@example.com", name: "Ada (second)" }), {}, T0);
    const tie = await insertInquiry(db(), inquiryInput({ email: "ada@example.com" }), { source: "form" });
    expect(await linkToKnownClient(db(), tie)).toBeNull();
  });

  it("links a message from a known client as it arrives through the form", async () => {
    const client = await createClient(db(), clientInput({ email: "grace@example.com" }), {}, T0);
    const channels = { email: null, ownerEmail: null, discordWebhookUrl: null };
    const inquiry = await submitInquiry(db(), inquiryInput({ email: "grace@example.com" }), {
      source: "form",
      siteUrl: null,
      channels,
    });
    expect(inquiry.clientId?.equals(client._id)).toBe(true);
    expect((await getInquiry(db(), inquiry._id))?.clientId?.equals(client._id)).toBe(true);
    const stranger = await submitInquiry(db(), inquiryInput({ email: "new@example.com" }), {
      source: "form",
      siteUrl: null,
      channels,
    });
    expect(stranger.clientId).toBeNull();
  });
});

describe("timeline, export and delete", () => {
  async function seed() {
    setClock(() => T0);
    const client = await createClient(db(), clientInput(), {}, T0);
    const message = await insertInquiry(db(), inquiryInput({ email: "ada@example.com" }), {
      source: "form",
      receivedAt: minutes(1),
    });
    await linkInquiry(db(), message._id, client._id, minutes(1));
    const project = (await createProject(db(), projectInput(client._id), {}, minutes(2)))!;
    await addActivity(db(), {
      clientId: client._id,
      projectId: project._id,
      kind: "call",
      body: "Scope",
      at: minutes(3),
    });
    await addRevision(db(), project._id, { title: "Bigger logo", details: "" }, minutes(4));
    await moveProject(db(), project._id, "delivered", null, minutes(5));
    const task = (await createTask(db(), { title: "Fix header", projectId: project._id }, minutes(6)))!;
    await addEntry(
      db(),
      {
        description: "Header",
        projectId: null,
        taskId: task._id,
        date: "2026-09-20",
        startTime: "13:00",
        seconds: 3600,
        billable: null,
      },
      "Europe/Istanbul",
      minutes(7),
    );
    await startTimer(db(), { description: "Running", projectId: project._id, taskId: null }, minutes(8));
    const unrelated = await createClient(
      db(),
      clientInput({ name: "Someone else", email: "else@example.com" }),
      {},
      T0,
    );
    await createTask(db(), { title: "Unrelated" }, minutes(9));
    return { client, message, project, task, unrelated };
  }

  it("merges messages, calls, projects and revision rounds, newest first", async () => {
    const { client, project } = await seed();
    const timeline = await clientTimeline(db(), client._id);
    expect(timeline.map((entry) => entry.type)).toEqual([
      "project",
      "revision",
      "activity",
      "project",
      "message",
    ]);
    expect(timeline[0]).toMatchObject({ type: "project", event: "delivered", ref: project.ref });
    expect(timeline[1]).toMatchObject({ type: "revision", number: 1, projectRef: project.ref });
    expect(timeline[3]).toMatchObject({ type: "project", event: "started" });
  });

  it("exports everything about a client", async () => {
    const { client } = await seed();
    const data = (await exportClient(db(), client._id, minutes(10)))!;
    expect(data.exportedAt).toBe(minutes(10).toISOString());
    expect(data.client).not.toHaveProperty("emailKey");
    expect(data.projects).toHaveLength(1);
    expect(data.projects[0]).not.toHaveProperty("rank");
    expect(data.revisions).toHaveLength(1);
    expect(data.tasks.map((task) => task.title)).toEqual(["Fix header"]);
    expect(data.timeEntries).toHaveLength(2);
    expect(data.log).toHaveLength(1);
    expect(data.messages).toHaveLength(1);
    // Plain JSON: ids and dates become strings.
    const json = JSON.parse(JSON.stringify(data)) as { client: { _id: string; createdAt: string } };
    expect(json.client._id).toBe(client._id.toHexString());
    expect(json.client.createdAt).toBe(T0.toISOString());
    expect(await exportClient(db(), new ObjectId())).toBeNull();
  });

  it("deletes a client with their work, keeping their messages unlinked and others untouched", async () => {
    const { client, message, unrelated } = await seed();
    expect(await deleteClient(db(), client._id)).toEqual({
      projects: 1,
      revisions: 1,
      tasks: 1,
      timeEntries: 2,
      log: 1,
      messagesUnlinked: 1,
      meetingsUnlinked: 0,
      portal: 0,
      dataRequests: 0,
    });
    expect(await getClient(db(), client._id)).toBeNull();
    expect((await getInquiry(db(), message._id))?.clientId).toBeNull();
    expect(await db().collection("time_entries").countDocuments({ running: true })).toBe(0);
    expect(await getClient(db(), unrelated._id)).not.toBeNull();
    expect(await db().collection("tasks").countDocuments()).toBe(1);
    expect(await deleteClient(db(), client._id)).toBeNull();
  });
});
