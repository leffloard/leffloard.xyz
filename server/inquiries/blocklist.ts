import "server-only";
import type { Db } from "mongodb";
import { now } from "@/server/clock";

// Senders whose messages go straight to spam, without alerts. They still get the normal "thanks" answer,
// so a blocked sender learns nothing from the form.

export type BlockKind = "email" | "domain";
export type BlockDoc = { _id: string; kind: BlockKind; value: string; createdAt: Date };

function blocklist(db: Db) {
  return db.collection<BlockDoc>("blocklist");
}

export function blockKey(kind: BlockKind, value: string): string {
  return `${kind}:${value.trim().toLowerCase()}`;
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

export async function isBlocked(db: Db, email: string): Promise<boolean> {
  const keys = [blockKey("email", email), blockKey("domain", domainOf(email))];
  return (await blocklist(db).countDocuments({ _id: { $in: keys } }, { limit: 1 })) > 0;
}

export async function block(db: Db, kind: BlockKind, email: string): Promise<BlockDoc> {
  const value = kind === "email" ? email.trim().toLowerCase() : domainOf(email);
  const doc: BlockDoc = { _id: blockKey(kind, value), kind, value, createdAt: now() };
  await blocklist(db).updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
  return doc;
}

export async function unblock(db: Db, key: string): Promise<boolean> {
  return (await blocklist(db).deleteOne({ _id: key })).deletedCount === 1;
}

export async function listBlocked(db: Db): Promise<BlockDoc[]> {
  return blocklist(db).find().sort({ createdAt: -1 }).limit(500).toArray();
}
