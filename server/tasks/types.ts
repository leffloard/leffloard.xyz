import type { ObjectId } from "mongodb";
import type { Recurrence, TaskStatus } from "@/lib/work/options";

export type ChecklistItem = { id: string; text: string; done: boolean };

export type TaskDoc = {
  _id: ObjectId;
  title: string;
  notes: string;
  projectId: ObjectId | null;
  clientId: ObjectId | null; // the project's client, kept for filtering
  revisionId: ObjectId | null; // a task made for a revision round
  status: TaskStatus;
  rank: string; // position among the tasks with the same project and status
  due: string | null; // YYYY-MM-DD in the owner's time zone
  someday: boolean; // parked: no date, out of the Anytime list
  flagged: boolean;
  recurrence: Recurrence | null; // finishing a repeating task moves it to its next date
  estimateSeconds: number | null;
  checklist: ChecklistItem[];
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  timesCompleted: number; // for repeating tasks
};
