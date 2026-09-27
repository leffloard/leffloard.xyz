import "server-only";
import { ObjectId, type Db } from "mongodb";
import type { ActivityDoc, ClientDoc } from "@/server/clients/types";
import type { ProjectDoc, RevisionDoc } from "@/server/projects/types";
import type { TaskDoc } from "@/server/tasks/types";
import type { TimeEntryDoc } from "@/server/time/types";

// The work modules' collections in one place, so the stores can reach each other's data without
// importing each other.

export function clients(db: Db) {
  return db.collection<ClientDoc>("clients");
}

export function activities(db: Db) {
  return db.collection<ActivityDoc>("activities");
}

export function projects(db: Db) {
  return db.collection<ProjectDoc>("projects");
}

export function revisions(db: Db) {
  return db.collection<RevisionDoc>("revisions");
}

export function tasks(db: Db) {
  return db.collection<TaskDoc>("tasks");
}

export function timeEntries(db: Db) {
  return db.collection<TimeEntryDoc>("time_entries");
}

// A route or form id, or null when it cannot be one.
export function parseId(id: string | null | undefined): ObjectId | null {
  return id && /^[a-f0-9]{24}$/.test(id) ? new ObjectId(id) : null;
}

export type UpdateOutcome<T> = { ok: true; doc: T } | { ok: false; reason: "missing" | "conflict" };
