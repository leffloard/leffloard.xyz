import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@/server/clients/store";
import { resetClock } from "@/server/clock";
import { runMigrations } from "@/server/db/migrate";
import { createProject } from "@/server/projects/store";
import {
  addChecklistItem,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  MAX_CHECKLIST_ITEMS,
  moveTask,
  projectBoard,
  removeChecklistItem,
  setChecklistItemDone,
  setDue,
  setFlagged,
  setTaskDone,
  taskChoices,
  taskCounts,
  updateTask,
} from "@/server/tasks/store";
import {
  addEntry,
  deleteEntry,
  MIN_TIMER_SECONDS,
  runningEntry,
  runningTimer,
  startTimer,
  stopTimer,
  updateEntry,
  weekEntries,
} from "@/server/time/store";
import { clientInput, projectInput } from "../helpers/work";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

setupTestEnv();
const { db } = setupTestDb();

beforeEach(async () => {
  await runMigrations(db());
});

afterEach(() => resetClock());

const T0 = new Date("2026-09-28T06:00:00Z"); // Monday 09:00 in Istanbul
const TODAY = "2026-09-28";
const ZONE = "Europe/Istanbul";
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

async function aProject(overrides = {}) {
  const client = await createClient(db(), clientInput(), {}, T0);
  return (await createProject(db(), projectInput(client._id, overrides), {}, T0))!;
}

const titles = (items: { title: string }[]) => items.map((item) => item.title);

describe("tasks", () => {
  it("adds tasks to the end of their list and moves them around the board", async () => {
    const project = await aProject();
    const [a, b, c] = [
      (await createTask(db(), { title: "A", projectId: project._id }, T0))!,
      (await createTask(db(), { title: "B", projectId: project._id }, minutes(1)))!,
      (await createTask(db(), { title: "C", projectId: project._id }, minutes(2)))!,
    ];
    expect(a.clientId?.equals(project.clientId)).toBe(true);
    expect(titles((await projectBoard(db(), project._id)).todo)).toEqual(["A", "B", "C"]);

    await moveTask(db(), c._id, { status: "todo", afterId: null }, TODAY, minutes(3));
    expect(titles((await projectBoard(db(), project._id)).todo)).toEqual(["C", "A", "B"]);

    await moveTask(db(), a._id, { status: "doing", afterId: null }, TODAY, minutes(4));
    await moveTask(db(), b._id, { status: "doing", afterId: a._id }, TODAY, minutes(5));
    const board = await projectBoard(db(), project._id);
    expect([titles(board.todo), titles(board.doing), titles(board.done)]).toEqual([["C"], ["A", "B"], []]);

    const done = await moveTask(db(), b._id, { status: "done", afterId: null }, TODAY, minutes(6));
    expect(done?.task).toMatchObject({ status: "done", completedAt: minutes(6), timesCompleted: 1 });
    const back = await moveTask(db(), b._id, { status: "todo", afterId: "end" }, TODAY, minutes(7));
    expect(back?.task.completedAt).toBeNull();
    expect(await createTask(db(), { title: "x", projectId: new ObjectId() })).toBeNull();
  });

  it("ticks tasks off to the top of the done list", async () => {
    const [a, b] = [
      (await createTask(db(), { title: "A" }, T0))!,
      (await createTask(db(), { title: "B" }, T0))!,
    ];
    await setTaskDone(db(), a._id, true, TODAY, minutes(1));
    await setTaskDone(db(), b._id, true, TODAY, minutes(2));
    const done = await db().collection("tasks").find({ status: "done" }).sort({ rank: 1 }).toArray();
    expect(done.map((task) => task.title)).toEqual(["B", "A"]);
    expect(titles(await listTasks(db(), "done", TODAY))).toEqual(["B", "A"]);
    const undone = await setTaskDone(db(), a._id, false, TODAY, minutes(3));
    expect(undone?.task).toMatchObject({ status: "todo", completedAt: null });
  });

  it("moves a repeating task to its next date when it is finished, once per click", async () => {
    const task = (await createTask(
      db(),
      { title: "Invoice run", due: "2026-09-25", recurrence: "weekly" },
      T0,
    ))!;
    await addChecklistItem(db(), task._id, "Export hours");
    const item = (await getTask(db(), task._id))!.checklist[0]!;
    await setChecklistItemDone(db(), task._id, item.id, true);

    const [first, second] = await Promise.all([
      setTaskDone(db(), task._id, true, TODAY, minutes(1)),
      setTaskDone(db(), task._id, true, TODAY, minutes(1)),
    ]);
    const repeated = [first, second].filter((outcome) => outcome?.repeatsOn);
    expect(repeated).toHaveLength(1);
    const after = (await getTask(db(), task._id))!;
    expect(after).toMatchObject({
      status: "todo",
      due: "2026-10-02",
      timesCompleted: 1,
      completedAt: minutes(1),
    });
    expect(after.checklist.every((entry) => !entry.done)).toBe(true);
  });

  it("sorts tasks into views and counts them", async () => {
    const project = await aProject();
    await createTask(db(), { title: "Late", due: "2026-09-20" }, T0);
    await createTask(db(), { title: "Now", due: TODAY, projectId: project._id }, T0);
    await createTask(db(), { title: "Later", due: "2026-10-05" }, T0);
    await createTask(db(), { title: "Whenever" }, T0);
    const flagged = (await createTask(db(), { title: "Important", flagged: false }, minutes(1)))!;
    await setFlagged(db(), flagged._id, true);
    await createTask(db(), { title: "Maybe", someday: true }, T0);
    const dated = (await createTask(db(), { title: "Parked, then dated", someday: true }, T0))!;
    await setDue(db(), dated._id, "2026-10-01", true);
    await createTask(db(), { title: "Finished", due: TODAY, status: "done" }, T0);

    expect(titles(await listTasks(db(), "today", TODAY))).toEqual(["Late", "Now"]);
    expect(titles(await listTasks(db(), "overdue", TODAY))).toEqual(["Late"]);
    expect(titles(await listTasks(db(), "upcoming", TODAY))).toEqual(["Parked, then dated", "Later"]);
    expect(titles(await listTasks(db(), "anytime", TODAY))).toEqual(["Important", "Whenever"]);
    expect(titles(await listTasks(db(), "someday", TODAY))).toEqual(["Maybe"]);
    expect(titles(await listTasks(db(), "done", TODAY))).toEqual(["Finished"]);
    expect(titles(await listTasks(db(), "today", TODAY, { projectId: project._id }))).toEqual(["Now"]);
    expect((await listTasks(db(), "today", TODAY))[1]?.project).toMatchObject({
      ref: project.ref,
      clientName: "Ada Lovelace",
    });
    expect(await taskCounts(db(), TODAY)).toEqual({
      today: 2,
      overdue: 1,
      upcoming: 2,
      anytime: 2,
      someday: 1,
      done: 0,
    });
    expect((await taskChoices(db())).map((choice) => choice.title)).toHaveLength(7);
  });

  it("keeps a checklist, within its limit", async () => {
    const task = (await createTask(db(), { title: "Launch" }, T0))!;
    for (let i = 0; i < MAX_CHECKLIST_ITEMS; i++) await addChecklistItem(db(), task._id, `Step ${i}`);
    expect(await addChecklistItem(db(), task._id, "Too many")).toBe("full");
    expect(await addChecklistItem(db(), new ObjectId(), "x")).toBeNull();
    const [first] = (await getTask(db(), task._id))!.checklist;
    expect((await removeChecklistItem(db(), task._id, first!.id))?.checklist).toHaveLength(
      MAX_CHECKLIST_ITEMS - 1,
    );
    expect(await setChecklistItemDone(db(), task._id, first!.id, true)).toBeNull();
  });

  it("moves a task to another project with its time, and deletes it keeping the time", async () => {
    const one = await aProject();
    const two = await aProject({ title: "Second", pricing: "hourly" });
    const task = (await createTask(db(), { title: "Fix", projectId: one._id }, T0))!;
    const entry = (await addEntry(
      db(),
      {
        description: "Fixing",
        projectId: null,
        taskId: task._id,
        date: TODAY,
        startTime: "10:00",
        seconds: 900,
        billable: null,
      },
      ZONE,
      T0,
    ))!;
    expect(entry.projectId?.equals(one._id)).toBe(true);

    const moved = (await updateTask(
      db(),
      task._id,
      {
        title: "Fix it",
        notes: "",
        projectId: two._id,
        due: null,
        someday: true,
        flagged: false,
        recurrence: null,
        estimateSeconds: 3600,
      },
      minutes(1),
    ))!;
    expect(moved.projectId?.equals(two._id)).toBe(true);
    expect(moved.someday).toBe(true);
    const movedEntry = await db().collection("time_entries").findOne({ _id: entry._id });
    expect(movedEntry?.projectId.equals(two._id)).toBe(true);

    expect((await deleteTask(db(), task._id))?.title).toBe("Fix it");
    expect((await db().collection("time_entries").findOne({ _id: entry._id }))?.taskId).toBeNull();
    expect(await updateTask(db(), task._id, { ...moved, projectId: null })).toBeNull();
  });
});

describe("time", () => {
  it("runs one timer at a time: starting one stops the other", async () => {
    const project = await aProject({ pricing: "hourly" });
    const first = (await startTimer(
      db(),
      { description: "Design", projectId: project._id, taskId: null },
      T0,
    ))!;
    expect(first.entry).toMatchObject({ running: true, billable: true, seconds: 0, endedAt: null });
    expect(first.stopped).toBeNull();

    const second = (await startTimer(
      db(),
      { description: "Email", projectId: null, taskId: null },
      minutes(30),
    ))!;
    expect(second.stopped).toMatchObject({ kept: true, entry: { seconds: 1800, endedAt: minutes(30) } });
    expect(second.stopped?.entry).not.toHaveProperty("running");
    expect(second.entry.billable).toBe(false);
    expect((await runningEntry(db()))?._id.equals(second.entry._id)).toBe(true);
    expect((await runningTimer(db()))?.description).toBe("Email");
  });

  it("never lets two timers run, even when they start at the same moment", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        startTimer(db(), { description: `T${i}`, projectId: null, taskId: null }, T0),
      ),
    );
    expect(results.every((result) => result !== null)).toBe(true);
    expect(await db().collection("time_entries").countDocuments({ running: true })).toBe(1);
    await expect(db().collection("time_entries").insertOne({ running: true, startedAt: T0 })).rejects.toThrow(
      /duplicate key/,
    );
  });

  it("drops a timer stopped within a minute", async () => {
    await startTimer(db(), { description: "Oops", projectId: null, taskId: null }, T0);
    const stopped = await stopTimer(db(), new Date(T0.getTime() + (MIN_TIMER_SECONDS - 1) * 1000));
    expect(stopped?.kept).toBe(false);
    expect(await db().collection("time_entries").countDocuments()).toBe(0);
    expect(await stopTimer(db(), minutes(5))).toBeNull();
  });

  it("adds, edits and lists entries by the owner's week", async () => {
    const project = await aProject();
    const monday = (await addEntry(
      db(),
      {
        description: "Plan",
        projectId: project._id,
        taskId: null,
        date: TODAY,
        startTime: "00:30",
        seconds: 3600,
        billable: null,
      },
      ZONE,
      T0,
    ))!;
    expect(monday.startedAt).toEqual(new Date("2026-09-27T21:30:00Z"));
    expect(monday.billable).toBe(false); // fixed price
    await addEntry(
      db(),
      {
        description: "Sunday",
        projectId: null,
        taskId: null,
        date: "2026-10-04",
        startTime: null,
        seconds: 600,
        billable: true,
      },
      ZONE,
      T0,
    );
    await addEntry(
      db(),
      {
        description: "Next week",
        projectId: null,
        taskId: null,
        date: "2026-10-05",
        startTime: "00:00",
        seconds: 600,
        billable: true,
      },
      ZONE,
      T0,
    );
    const week = await weekEntries(db(), TODAY, ZONE);
    expect(week.map((entry) => entry.description)).toEqual(["Plan", "Sunday"]);
    expect(week[0]?.project?.ref).toBe(project.ref);

    const edited = await updateEntry(
      db(),
      monday._id,
      {
        description: "Planning",
        projectId: null,
        billable: true,
        date: "2026-09-29",
        startTime: "14:00",
        seconds: 5400,
      },
      ZONE,
      minutes(1),
    );
    expect(edited).toMatchObject({
      description: "Planning",
      projectId: null,
      clientId: null,
      billable: true,
      seconds: 5400,
      startedAt: new Date("2026-09-29T11:00:00Z"),
      endedAt: new Date("2026-09-29T12:30:00Z"),
    });
    expect(
      await updateEntry(
        db(),
        new ObjectId(),
        { ...edited!, date: null, startTime: null, seconds: null },
        ZONE,
      ),
    ).toBeNull();
    expect((await deleteEntry(db(), monday._id))?.description).toBe("Planning");
  });

  it("changes only the description, project and billable flag of a running timer", async () => {
    const started = (await startTimer(db(), { description: "Work", projectId: null, taskId: null }, T0))!;
    const edited = await updateEntry(
      db(),
      started.entry._id,
      {
        description: "Deep work",
        projectId: null,
        billable: true,
        date: "2026-09-01",
        startTime: "08:00",
        seconds: 60,
      },
      ZONE,
      minutes(1),
    );
    expect(edited).toMatchObject({ description: "Deep work", billable: true, startedAt: T0, running: true });
  });

  it("refuses entries for tasks or projects that do not exist", async () => {
    expect(await startTimer(db(), { description: "", projectId: new ObjectId(), taskId: null })).toBeNull();
    expect(await startTimer(db(), { description: "", projectId: null, taskId: new ObjectId() })).toBeNull();
    expect(
      await addEntry(
        db(),
        {
          description: "",
          projectId: new ObjectId(),
          taskId: null,
          date: TODAY,
          startTime: null,
          seconds: 60,
          billable: null,
        },
        ZONE,
      ),
    ).toBeNull();
  });
});
