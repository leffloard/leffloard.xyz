import "server-only";
import { ObjectId, type Db } from "mongodb";
import { now } from "@/server/clock";
import { projectUpdates } from "@/server/portal/collections";
import type { ProjectUpdateDoc } from "@/server/portal/types";

// The owner's notes to a client on their project, shown in the client's portal (and emailed, if asked).

export async function addProjectUpdate(
  db: Db,
  project: { _id: ObjectId; clientId: ObjectId },
  body: string,
  emailed: boolean,
  at: Date = now(),
): Promise<ProjectUpdateDoc> {
  const doc: ProjectUpdateDoc = {
    _id: new ObjectId(),
    projectId: project._id,
    clientId: project.clientId,
    body,
    emailed,
    createdAt: at,
  };
  await projectUpdates(db).insertOne(doc);
  return doc;
}

export async function markUpdateEmailed(db: Db, id: ObjectId): Promise<void> {
  await projectUpdates(db).updateOne({ _id: id }, { $set: { emailed: true } });
}

export async function deleteProjectUpdate(db: Db, projectId: ObjectId, id: ObjectId): Promise<boolean> {
  return (await projectUpdates(db).deleteOne({ _id: id, projectId })).deletedCount === 1;
}

export async function updatesForProject(
  db: Db,
  projectId: ObjectId,
  limit = 100,
): Promise<ProjectUpdateDoc[]> {
  return projectUpdates(db).find({ projectId }).sort({ createdAt: -1 }).limit(limit).toArray();
}
