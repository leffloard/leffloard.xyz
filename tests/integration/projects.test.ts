import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { money } from "@/lib/money";
import { createClient, getClient } from "@/server/clients/store";
import { resetClock } from "@/server/clock";
import { runMigrations } from "@/server/db/migrate";
import {
  addLink,
  addMilestone,
  boardProjects,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  MAX_LINKS,
  moveProject,
  nextProjectRef,
  projectChoices,
  projectLabels,
  projectNumbers,
  removeLink,
  removeMilestone,
  setMilestoneDone,
  updateProject,
} from "@/server/projects/store";
import {
  addRevision,
  CancelledRevisionError,
  listRevisions,
  setRevisionBillable,
  setRevisionPolicy,
  setRevisionStatus,
} from "@/server/projects/revisions";
import { createTask, getTask } from "@/server/tasks/store";
import { addEntry } from "@/server/time/store";
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

async function aClient(overrides = {}) {
  return createClient(db(), clientInput(overrides), {}, T0);
}

describe("projects", () => {
  it("numbers projects in one sequence", async () => {
    expect(await nextProjectRef(db())).toBe("PRJ-001");
    const client = await aClient();
    expect((await createProject(db(), projectInput(client._id), {}, T0))?.ref).toBe("PRJ-002");
    expect(await createProject(db(), projectInput(new ObjectId()), {}, T0)).toBeNull();
  });

  it("edits with optimistic concurrency, and a project that moves client takes its work along", async () => {
    const ada = await aClient();
    const grace = await aClient({ name: "Grace Hopper", email: "grace@example.com" });
    const project = (await createProject(db(), projectInput(ada._id), {}, T0))!;
    const task = (await createTask(db(), { title: "Wireframes", projectId: project._id }, T0))!;
    await addRevision(db(), project._id, { title: "Round", details: "" }, T0);
    await addEntry(
      db(),
      {
        description: "",
        projectId: project._id,
        taskId: null,
        date: "2026-09-20",
        startTime: null,
        seconds: 600,
        billable: null,
      },
      "Europe/Istanbul",
      T0,
    );

    const moved = await updateProject(
      db(),
      project._id,
      1,
      projectInput(grace._id, { title: "Shop v2" }),
      minutes(1),
    );
    expect(moved.ok && moved.doc.title).toBe("Shop v2");
    expect((await getTask(db(), task._id))?.clientId?.equals(grace._id)).toBe(true);
    expect(await db().collection("revisions").countDocuments({ clientId: grace._id })).toBe(1);
    expect(await db().collection("time_entries").countDocuments({ clientId: grace._id })).toBe(1);
    expect((await getClient(db(), grace._id))?.status).toBe("active");

    expect(await updateProject(db(), project._id, 1, projectInput(grace._id), minutes(2))).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(await updateProject(db(), project._id, 2, projectInput(new ObjectId()), minutes(2))).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("orders board columns by rank, puts new projects on top and moves them between stages", async () => {
    const client = await aClient();
    const a = (await createProject(db(), projectInput(client._id, { title: "A" }), {}, T0))!;
    const b = (await createProject(db(), projectInput(client._id, { title: "B" }), {}, minutes(1)))!;
    const c = (await createProject(db(), projectInput(client._id, { title: "C" }), {}, minutes(2)))!;
    const column = async (stage: string) =>
      (await boardProjects(db(), minutes(10))).filter((p) => p.stage === stage).map((p) => p.title);
    expect(await column("planned")).toEqual(["C", "B", "A"]);

    await moveProject(db(), c._id, "planned", a._id, minutes(3)); // C after A
    expect(await column("planned")).toEqual(["B", "A", "C"]);

    await moveProject(db(), a._id, "active", null, minutes(4));
    await moveProject(db(), b._id, "active", "end", minutes(5));
    expect(await column("active")).toEqual(["A", "B"]);
    expect(await column("planned")).toEqual(["C"]);

    const delivered = await moveProject(db(), b._id, "delivered", null, minutes(6));
    expect(delivered?.deliveredAt).toEqual(minutes(6));
    expect(delivered?.stageChangedAt).toEqual(minutes(6));
    // Delivered projects leave the board after 30 days.
    expect(await column("delivered")).toEqual(["B"]);
    expect(
      (await boardProjects(db(), new Date(minutes(6).getTime() + 31 * 86_400_000))).map((p) => p.title),
    ).toEqual(["A", "C"]);
    const reopened = await moveProject(db(), b._id, "active", null, minutes(7));
    expect(reopened?.deliveredAt).toBeNull();
  });

  it("lists open work by due date, filters by client, and names projects for other lists", async () => {
    const ada = await aClient();
    const grace = await aClient({ name: "Grace Hopper", email: "grace@example.com" });
    const late = (await createProject(
      db(),
      projectInput(ada._id, { title: "Late", dueDate: "2026-10-30" }),
      {},
      T0,
    ))!;
    const soon = (await createProject(
      db(),
      projectInput(ada._id, { title: "Soon", dueDate: "2026-10-01" }),
      {},
      minutes(1),
    ))!;
    await createProject(db(), projectInput(grace._id, { title: "Undated" }), {}, minutes(2));
    await createProject(db(), projectInput(grace._id, { title: "Gone" }), { stage: "cancelled" }, minutes(3));
    await createTask(db(), { title: "One", projectId: soon._id }, T0);
    await createTask(db(), { title: "Two", projectId: soon._id, status: "done" }, T0);

    const open = await listProjects(db(), { view: "open" });
    expect(open.items.map((p) => p.title)).toEqual(["Soon", "Late", "Undated"]);
    expect(open.items[0]).toMatchObject({ clientName: "Ada Lovelace", openTasks: 1 });
    expect(open.counts).toMatchObject({ open: 3, all: 4, planned: 3, cancelled: 1 });

    const graceOnly = await listProjects(db(), { view: "all", clientId: grace._id });
    expect(graceOnly.items.map((p) => p.title)).toEqual(["Gone", "Undated"]);
    expect((await listProjects(db(), { view: "all", q: "late" })).items.map((p) => p.title)).toEqual([
      "Late",
    ]);

    expect((await projectChoices(db())).map((p) => p.title)).toEqual(["Undated", "Soon", "Late"]);
    const labels = await projectLabels(db(), [late._id]);
    expect(labels.get(late._id.toHexString())).toEqual({
      id: late._id.toHexString(),
      ref: late.ref,
      title: "Late",
      clientName: "Ada Lovelace",
    });
  });

  it("keeps milestones and links, within limits", async () => {
    const client = await aClient();
    const project = (await createProject(db(), projectInput(client._id), {}, T0))!;
    const withMilestone = await addMilestone(
      db(),
      project._id,
      { title: "Design approved", dueDate: "2026-10-01" },
      T0,
    );
    expect(withMilestone !== null && withMilestone !== "full" && withMilestone.milestones).toHaveLength(1);
    const milestone = (await getProject(db(), project._id))!.milestones[0]!;
    const done = await setMilestoneDone(db(), project._id, milestone.id, true, minutes(1));
    expect(done?.milestones[0]).toMatchObject({ done: true, doneAt: minutes(1) });
    expect(await setMilestoneDone(db(), project._id, "nope", true)).toBeNull();
    expect((await removeMilestone(db(), project._id, milestone.id))?.milestones).toEqual([]);

    for (let i = 0; i < MAX_LINKS; i++) {
      await addLink(db(), project._id, { label: `Link ${i}`, url: `https://example.com/${i}` });
    }
    expect(await addLink(db(), project._id, { label: "One more", url: "https://example.com" })).toBe("full");
    expect(await addLink(db(), new ObjectId(), { label: "x", url: "https://example.com" })).toBeNull();
    const first = (await getProject(db(), project._id))!.links[0]!;
    expect((await removeLink(db(), project._id, first.id))?.links).toHaveLength(MAX_LINKS - 1);
  });

  it("adds up tracked time and tasks", async () => {
    const client = await aClient();
    const project = (await createProject(db(), projectInput(client._id), {}, T0))!;
    const entry = (seconds: number, billable: boolean) =>
      addEntry(
        db(),
        {
          description: "",
          projectId: project._id,
          taskId: null,
          date: "2026-09-20",
          startTime: null,
          seconds,
          billable,
        },
        "Europe/Istanbul",
        T0,
      );
    await entry(3600, true);
    await entry(1800, false);
    await createTask(db(), { title: "a", projectId: project._id }, T0);
    await createTask(db(), { title: "b", projectId: project._id, status: "doing" }, T0);
    expect(await projectNumbers(db(), project._id)).toEqual({
      seconds: 5400,
      billableSeconds: 3600,
      tasks: { todo: 1, doing: 1, done: 0 },
    });
  });

  it("deletes a project with its tasks, rounds and time", async () => {
    const client = await aClient();
    const project = (await createProject(db(), projectInput(client._id), {}, T0))!;
    const other = (await createProject(db(), projectInput(client._id, { title: "Other" }), {}, T0))!;
    await createTask(db(), { title: "a", projectId: project._id }, T0);
    await createTask(db(), { title: "b", projectId: other._id }, T0);
    await addRevision(db(), project._id, { title: "r", details: "" }, T0);
    await db().collection("activities").insertOne({
      clientId: client._id,
      projectId: project._id,
      kind: "note",
      body: "x",
      at: T0,
      createdAt: T0,
    });
    expect(await deleteProject(db(), project._id)).toEqual({ tasks: 1, revisions: 1, timeEntries: 0 });
    expect(await getProject(db(), project._id)).toBeNull();
    expect(await db().collection("tasks").countDocuments()).toBe(1);
    expect(await db().collection("activities").countDocuments({ projectId: null })).toBe(1);
    expect(await deleteProject(db(), project._id)).toBeNull();
  });
});

describe("revision rounds", () => {
  it("counts rounds against the included ones and prices the extra ones", async () => {
    const client = await aClient();
    const project = (await createProject(db(), projectInput(client._id), {}, T0))!;
    const rounds = [];
    for (let i = 1; i <= 3; i++) {
      rounds.push((await addRevision(db(), project._id, { title: `Round ${i}`, details: "" }, minutes(i)))!);
    }
    expect(rounds.map((round) => [round.number, round.billable, round.price])).toEqual([
      [1, false, null],
      [2, false, null],
      [3, true, money(6_000, "USD")],
    ]);
    const after = (await getProject(db(), project._id))!;
    expect([after.revisionsUsed, after.revisionSeq]).toEqual([3, 3]);
    expect(await addRevision(db(), new ObjectId(), { title: "x", details: "" })).toBeNull();
  });

  it("hands out unique numbers to rounds added at the same moment", async () => {
    const client = await aClient();
    const project = (await createProject(
      db(),
      projectInput(client._id, { revisionPolicy: { included: 3, extraPrice: null } }),
      {},
      T0,
    ))!;
    const rounds = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        addRevision(db(), project._id, { title: `R${i}`, details: "" }, T0),
      ),
    );
    expect(rounds.map((round) => round!.number).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rounds.filter((round) => round!.billable)).toHaveLength(3);
    expect((await getProject(db(), project._id))!.revisionsUsed).toBe(6);
  });

  it("gives a cancelled round back and keeps it cancelled", async () => {
    const client = await aClient();
    const project = (await createProject(db(), projectInput(client._id), {}, T0))!;
    const round = (await addRevision(db(), project._id, { title: "Logo", details: "" }, T0))!;
    expect((await setRevisionStatus(db(), round._id, "done", minutes(1)))?.completedAt).toEqual(minutes(1));
    expect((await setRevisionStatus(db(), round._id, "open", minutes(2)))?.completedAt).toBeNull();
    await setRevisionStatus(db(), round._id, "cancelled", minutes(3));
    await setRevisionStatus(db(), round._id, "cancelled", minutes(4)); // twice gives back once
    expect((await getProject(db(), project._id))!.revisionsUsed).toBe(0);
    await expect(setRevisionStatus(db(), round._id, "open")).rejects.toThrow(CancelledRevisionError);
    expect(await setRevisionStatus(db(), new ObjectId(), "done")).toBeNull();

    const next = (await addRevision(db(), project._id, { title: "Colours", details: "" }, minutes(5)))!;
    expect(next.number).toBe(2);
    expect(next.billable).toBe(false);
  });

  it("changes the policy and marks rounds included or extra by hand", async () => {
    const client = await aClient();
    const project = (await createProject(db(), projectInput(client._id), {}, T0))!;
    const round = (await addRevision(db(), project._id, { title: "Logo", details: "" }, T0))!;
    const updated = await setRevisionPolicy(db(), project._id, {
      included: 0,
      extraPrice: money(8_000, "USD"),
    });
    expect(updated?.version).toBe(2);
    const extra = await setRevisionBillable(db(), round._id, true);
    expect([extra?.billable, extra?.price]).toEqual([true, money(8_000, "USD")]);
    const included = await setRevisionBillable(db(), round._id, false);
    expect([included?.billable, included?.price]).toEqual([false, null]);
    expect((await listRevisions(db(), project._id)).map((r) => r.number)).toEqual([1]);
  });
});
