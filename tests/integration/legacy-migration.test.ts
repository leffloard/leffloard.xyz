import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "@/server/db/migrate";
import { migrateLegacy, verifyLegacy } from "@/server/inquiries/legacy-migration";
import type { InquiryDoc } from "@/server/inquiries/types";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

setupTestEnv();
const { db } = setupTestDb();

// Documents exactly as the v1 backend stored them (see backend/server.py create_request and PATCH).
const V1_REQUESTS = [
  {
    id: "7b1f0a52-0c1e-4c55-9a0e-3a1f2b3c4d5e",
    type: "appointment",
    name: "Ada Lovelace",
    email: "ada@example.com",
    contact_handle: "ada#0001",
    service: "Web Development",
    subject: "Kickoff call",
    message: "Let's plan the new landing page.",
    project_reference: null,
    timezone: "Europe/Istanbul",
    preferred_date: "2026-06-01",
    preferred_time: "14:30",
    duration_minutes: 45,
    status: "completed",
    created_at: "2026-05-20T08:00:00.000+00:00",
    updated_at: "2026-06-02T10:00:00.000+00:00",
    admin_note: "Bring the brand guide.",
    scheduled_at: "2026-06-01T11:30:00+00:00",
    history: [
      { status: "confirmed", from: "new", at: "2026-05-21T09:00:00.000+00:00" },
      { status: "completed", from: "confirmed", at: "2026-06-02T10:00:00.000+00:00" },
    ],
  },
  {
    id: "0c9d8e7f-6a5b-4c3d-8e2f-1a0b9c8d7e6f",
    type: "inquiry",
    name: "Alan Turing",
    email: "alan@example.com",
    contact_handle: null,
    service: "Loader / Desktop App",
    subject: "Desktop app pricing",
    message: "How much would a small tool cost?",
    project_reference: null,
    timezone: null,
    preferred_date: null,
    preferred_time: null,
    duration_minutes: null,
    status: "new",
    created_at: "2026-07-01T12:00:00.000+00:00",
    updated_at: "2026-07-01T12:00:00.000+00:00",
    admin_note: "",
    scheduled_at: null,
    history: [],
  },
  {
    id: "5e4d3c2b-1a09-4f8e-9d7c-6b5a4f3e2d1c",
    type: "revision",
    name: "Grace Hopper",
    email: "grace@example.com",
    contact_handle: null,
    service: null,
    subject: "Change the hero colours",
    message: "Please make the hero section darker.",
    project_reference: "Order #1042 - Portfolio",
    timezone: null,
    preferred_date: null,
    preferred_time: null,
    duration_minutes: null,
    status: "declined",
    created_at: "2026-06-15T12:00:00.000+00:00",
    updated_at: "2026-06-16T12:00:00.000+00:00",
    admin_note: "",
    scheduled_at: null,
    history: [{ status: "declined", from: "new", at: "2026-06-16T12:00:00.000+00:00" }],
  },
  { id: "broken-1", type: "inquiry", name: "", email: "x@example.com", created_at: "2026-07-02T00:00:00Z" },
];

beforeEach(async () => {
  await runMigrations(db());
  await db()
    .collection("requests")
    .insertMany(V1_REQUESTS.map((request) => ({ ...request })));
});

const copies = () => db().collection<InquiryDoc>("inquiries").find().sort({ receivedAt: 1 }).toArray();
const v1Snapshot = () =>
  db()
    .collection("requests")
    .find({}, { projection: { _id: 0 } })
    .sort({ id: 1 })
    .toArray();

describe("copying the v1 requests", () => {
  it("reports without writing in a dry run", async () => {
    const report = await migrateLegacy(db(), { apply: false });
    expect(report).toEqual({
      total: 4,
      alreadyCopied: 0,
      toCopy: 3,
      copied: 0,
      problems: [{ id: "broken-1", problem: "misses a name, email, subject, message or date" }],
      byType: { call: 1, question: 1, revision: 1 },
      byStatus: { done: 1, new: 1, declined: 1 },
    });
    expect(await copies()).toEqual([]);
  });

  it("copies every readable request with its history, once, and leaves v1's data alone", async () => {
    const before = await v1Snapshot();
    const first = await migrateLegacy(db(), { apply: true });
    expect(first).toMatchObject({ total: 4, copied: 3, alreadyCopied: 0 });
    const again = await migrateLegacy(db(), { apply: true });
    expect(again).toMatchObject({ total: 4, copied: 0, alreadyCopied: 3, toCopy: 0 });
    expect(await v1Snapshot()).toEqual(before);

    const [call, revision, question] = await copies();
    expect(call).toMatchObject({
      publicId: "7b1f0a52-0c1e-4c55-9a0e-3a1f2b3c4d5e",
      legacyId: "7b1f0a52-0c1e-4c55-9a0e-3a1f2b3c4d5e",
      ref: "INQ-2026-0001",
      kind: "call",
      status: "done",
      source: "legacy-import",
      service: "websites",
      contact: "ada#0001",
      note: "Bring the brand guide.",
      call: { timeZone: "Europe/Istanbul", date: "2026-06-01", time: "14:30", duration: 45 },
      scheduledAt: new Date("2026-06-01T11:30:00Z"),
      receivedAt: new Date("2026-05-20T08:00:00Z"),
      updatedAt: new Date("2026-06-02T10:00:00Z"),
      history: [
        { status: "confirmed", from: "new", at: new Date("2026-05-21T09:00:00Z") },
        { status: "done", from: "confirmed", at: new Date("2026-06-02T10:00:00Z") },
      ],
    });
    expect(revision).toMatchObject({
      ref: "INQ-2026-0002",
      kind: "revision",
      status: "declined",
      projectReference: "Order #1042 - Portfolio",
    });
    expect(question).toMatchObject({
      ref: "INQ-2026-0003",
      kind: "question",
      status: "new",
      service: "desktop-software",
    });
  });

  it("verifies the copy, and notices what is missing or different", async () => {
    await migrateLegacy(db(), { apply: true });
    expect(await verifyLegacy(db())).toEqual({ total: 4, matched: 3, missing: [], different: [] });

    await db().collection("inquiries").deleteOne({ legacyId: "0c9d8e7f-6a5b-4c3d-8e2f-1a0b9c8d7e6f" });
    await db()
      .collection("inquiries")
      .updateOne({ legacyId: "5e4d3c2b-1a09-4f8e-9d7c-6b5a4f3e2d1c" }, { $set: { subject: "Changed" } });
    const report = await verifyLegacy(db());
    expect(report.missing).toEqual(["0c9d8e7f-6a5b-4c3d-8e2f-1a0b9c8d7e6f"]);
    expect(report.different).toEqual([{ id: "5e4d3c2b-1a09-4f8e-9d7c-6b5a4f3e2d1c", fields: ["subject"] }]);

    // Copying again restores the missing one and keeps changes made in the inbox.
    expect(await migrateLegacy(db(), { apply: true })).toMatchObject({ copied: 1 });
    expect((await verifyLegacy(db())).missing).toEqual([]);
  });
});
