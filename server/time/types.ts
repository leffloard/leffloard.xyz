import type { ObjectId } from "mongodb";

export type TimeEntryDoc = {
  _id: ObjectId;
  description: string;
  projectId: ObjectId | null;
  clientId: ObjectId | null;
  taskId: ObjectId | null;
  startedAt: Date;
  endedAt: Date | null; // null while the timer runs
  seconds: number; // 0 while the timer runs
  // Present only on the running entry. A unique partial index on it means at most one timer runs.
  running?: true;
  billable: boolean;
  source: "timer" | "manual";
  createdAt: Date;
  updatedAt: Date;
};
