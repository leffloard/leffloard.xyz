import "server-only";
import { ObjectId, type Db } from "mongodb";
import { blocks } from "@/server/calendar/settings";
import type { BlockDoc, BlockKind } from "@/server/calendar/types";
import { now } from "@/server/clock";

// Blocks: time the owner keeps free of bookings (school, an exam, focus time, a trip).

export const BLOCK_KINDS: BlockKind[] = ["school", "exam", "focus", "away", "other"];

export const BLOCK_LABELS: Record<BlockKind, string> = {
  school: "School",
  exam: "Exam",
  focus: "Focus time",
  away: "Away",
  other: "Busy",
};

export async function createBlock(
  db: Db,
  input: { title: string; kind: BlockKind; startsAt: Date; endsAt: Date },
  at: Date = now(),
): Promise<BlockDoc> {
  const doc: BlockDoc = { _id: new ObjectId(), ...input, createdAt: at };
  await blocks(db).insertOne(doc);
  return doc;
}

export async function deleteBlock(db: Db, id: ObjectId): Promise<boolean> {
  return (await blocks(db).deleteOne({ _id: id })).deletedCount === 1;
}

export async function blocksBetween(db: Db, from: Date, to: Date): Promise<BlockDoc[]> {
  return blocks(db)
    .find({ startsAt: { $lt: to }, endsAt: { $gt: from } })
    .sort({ startsAt: 1 })
    .limit(500)
    .toArray();
}
