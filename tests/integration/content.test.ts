import { ObjectId } from "mongodb";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONTENT_SCHEMAS, type ContentInput } from "@/lib/content/schemas";
import { resetClock, setClock } from "@/server/clock";
import { contentItems, contentState, contentVersions } from "@/server/content/collections";
import {
  contentStatus,
  createContent,
  deleteContent,
  getContent,
  getSingleton,
  listVersions,
  moveContent,
  publishContent,
  publishDue,
  restoreVersion,
  saveContentSettings,
  saveDraft,
  scheduleContent,
  unpublishContent,
} from "@/server/content/editor";
import { endPreview, previewKeyValid, startPreview } from "@/server/content/preview";
import { seedContent } from "@/server/content/seed";
import { contentGeneration, loadContent } from "@/server/content/store";
import { closeClient } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { readChannels } from "@/server/notify/channels";
import type { OutboxDoc } from "@/server/notify/outbox";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

const { db, url, name } = setupTestDb();
setupTestEnv({
  MONGO_URL: url,
  DB_NAME: name,
  EMAIL_DELIVERY: "log",
  NOTIFY_EMAIL_TO: "owner@leffloard.test",
});

const NOW = new Date("2026-09-28T06:00:00Z");
const LATER = new Date("2026-09-28T07:00:00Z");

beforeEach(async () => {
  await runMigrations(db());
  setClock(() => NOW);
});

afterEach(() => resetClock());

afterAll(async () => {
  await closeClient();
});

function post(overrides: Partial<ContentInput["post"]> = {}) {
  return CONTENT_SCHEMAS.post.parse({
    slug: "shipping-the-portal",
    title: "Shipping the client portal",
    description: "How sign-in links work without passwords.",
    date: "2026-09-28",
    tags: ["security"],
    body: "## Why links\n\nClients visit a few times a month.\n\n```ts\nconst link = true;\n```",
    ...overrides,
  });
}

describe("the seed", () => {
  it("fills an empty database once, even when two processes start together", async () => {
    const results = await Promise.all([seedContent(db(), NOW), seedContent(db(), NOW)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await seedContent(db(), NOW)).toBe(false);
    expect(await contentGeneration(db())).toBe(1);

    const content = await loadContent(db(), "published");
    expect(content.work.map((item) => item.slug)).toContain("leffloard-xyz");
    expect(content.services).toHaveLength(4);
    expect(content.posts.length).toBeGreaterThanOrEqual(2);
    expect(content.posts[0]!.html).toContain("<h2");
    expect(content.profile.availability.openLabel).toBe("Taking new projects");
    expect(content.cv.headline).toBe("Independent software developer");
    expect(content.pricing.terms.length).toBeGreaterThan(0);
    expect(content.testimonials).toEqual([]);
  });
});

describe("editing", () => {
  it("keeps a new item off the site until it is published, and versions what it replaces", async () => {
    await seedContent(db(), NOW);
    const created = await createContent(db(), "post", post(), NOW);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(contentStatus(created.doc)).toBe("draft");
    expect((await loadContent(db(), "published")).posts.map((item) => item.slug)).not.toContain(
      "shipping-the-portal",
    );
    expect((await loadContent(db(), "draft")).posts.map((item) => item.slug)).toContain(
      "shipping-the-portal",
    );

    const first = await publishContent(db(), created.doc._id, 1, NOW);
    expect(first.ok).toBe(true);
    expect(await contentGeneration(db())).toBe(2);
    const live = (await loadContent(db(), "published")).posts.find(
      (item) => item.slug === "shipping-the-portal",
    );
    expect(live?.html).toContain('class="shiki');

    // A new draft, then a second publication: the first copy becomes a version.
    const saved = await saveDraft(
      db(),
      created.doc._id,
      "post",
      1,
      post({ title: "The client portal" }),
      LATER,
    );
    expect(saved.ok && contentStatus(saved.doc)).toBe("changed");
    expect((await publishContent(db(), created.doc._id, 2, LATER)).ok).toBe(true);
    const versions = await listVersions(db(), created.doc._id);
    expect(versions.map((version) => (version.data as { title: string }).title)).toEqual([
      "Shipping the client portal",
    ]);

    // Bringing the version back puts it in the draft, not on the site.
    const restored = await restoreVersion(db(), created.doc._id, versions[0]!._id, 2, LATER);
    expect(restored.ok && restored.doc.draft).toMatchObject({ title: "Shipping the client portal" });
    expect((await getContent(db(), created.doc._id))?.published).toMatchObject({
      title: "The client portal",
    });
  });

  it("checks and renders a version again before it goes back into the draft", async () => {
    await seedContent(db(), NOW);
    const created = await createContent(db(), "post", post(), NOW);
    if (!created.ok) throw new Error("not created");
    // A kept copy whose date no longer passes the rules, and whose stored HTML is not what its Markdown gives.
    const broken = await contentVersions(db()).insertOne({
      _id: new ObjectId(),
      contentId: created.doc._id,
      kind: "post",
      key: "shipping-the-portal",
      data: { ...created.doc.draft, date: "2026-13-01" },
      publishedAt: NOW,
      replacedAt: NOW,
    } as never);
    expect(await restoreVersion(db(), created.doc._id, broken.insertedId, 1, NOW)).toMatchObject({
      ok: false,
      reason: "field",
      field: "form",
      message: expect.stringContaining("This version no longer passes today's rules (date"),
    });
    const tampered = await contentVersions(db()).insertOne({
      _id: new ObjectId(),
      contentId: created.doc._id,
      kind: "post",
      key: "shipping-the-portal",
      data: { ...created.doc.draft, html: '<p><img src="x" onerror="alert(1)"></p>' },
      publishedAt: NOW,
      replacedAt: NOW,
    } as never);
    const restored = await restoreVersion(db(), created.doc._id, tampered.insertedId, 1, NOW);
    expect(restored.ok && (restored.doc.draft as { html: string }).html).not.toContain("onerror");
  });

  it("refuses a save from an older page, a taken address, and a publication of an unseen draft", async () => {
    await seedContent(db(), NOW);
    const created = await createContent(db(), "post", post(), NOW);
    if (!created.ok) throw new Error("not created");
    expect(await createContent(db(), "post", post(), NOW)).toEqual({
      ok: false,
      reason: "field",
      field: "slug",
      message: "Another item already uses this address.",
    });
    expect(
      await saveDraft(db(), created.doc._id, "post", 1, post({ slug: "let-the-model-read-never-count" })),
    ).toMatchObject({
      ok: false,
      reason: "field",
      field: "slug",
    });
    expect((await saveDraft(db(), created.doc._id, "post", 1, post({ title: "One" }))).ok).toBe(true);
    expect(await saveDraft(db(), created.doc._id, "post", 1, post({ title: "Two" }))).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(await publishContent(db(), created.doc._id, 1, NOW)).toEqual({ ok: false, reason: "conflict" });
  });

  it("marks a draft unchanged again when it matches what is published", async () => {
    await seedContent(db(), NOW);
    const profile = (await getSingleton(db(), "profile"))!;
    if (profile.kind !== "profile") throw new Error("not the profile");
    const input = CONTENT_SCHEMAS.profile.parse({
      ...profile.draft,
      availability: { ...profile.draft.availability, open: false },
    });
    const closed = await saveDraft(db(), profile._id, "profile", 1, input, NOW);
    expect(closed.ok && contentStatus(closed.doc)).toBe("changed");
    const back = await saveDraft(
      db(),
      profile._id,
      "profile",
      2,
      CONTENT_SCHEMAS.profile.parse(profile.draft),
      NOW,
    );
    expect(back.ok && contentStatus(back.doc)).toBe("published");
  });
});

describe("the checks before publishing", () => {
  it("stops a leak, and the owner's own words", async () => {
    await seedContent(db(), NOW);
    const leaky = await createContent(
      db(),
      "post",
      post({ body: `The webhook is https://discord.com/api/${"webhooks"}/123456789012345678/secret.` }),
      NOW,
    );
    if (!leaky.ok) throw new Error("not created");
    const refused = await publishContent(db(), leaky.doc._id, 1, NOW);
    expect(refused.ok === false && refused.reason === "leaks" && refused.findings.map((f) => f.rule)).toEqual(
      ["discord-webhook", "discord-id"],
    );

    expect(await saveContentSettings(db(), ["Acme Corp"], 0, NOW)).toBe(true);
    const named = await createContent(
      db(),
      "post",
      post({ slug: "acme", body: "Built for acme corp." }),
      NOW,
    );
    if (!named.ok) throw new Error("not created");
    const blocked = await publishContent(db(), named.doc._id, 1, NOW);
    expect(blocked.ok === false && blocked.reason === "leaks" && blocked.findings).toEqual([
      { rule: "banned-word", label: "A word on your list", excerpt: "Acme Corp" },
    ]);
    expect(await contentGeneration(db())).toBe(1);
  });

  it("publishes a testimonial only with the person's permission, and never the note about it", async () => {
    await seedContent(db(), NOW);
    const input = {
      quote: "Delivered early and explained everything.",
      name: "Ada Lovelace",
      role: "Founder, Analytical Engines",
      workSlug: "leffloard-xyz",
      consent: false,
      consentNote: "Agreed by email on 26 September",
    };
    const created = await createContent(db(), "testimonial", CONTENT_SCHEMAS.testimonial.parse(input), NOW);
    if (!created.ok) throw new Error("not created");
    expect(await publishContent(db(), created.doc._id, 1, NOW)).toEqual({ ok: false, reason: "consent" });
    const agreed = await saveDraft(
      db(),
      created.doc._id,
      "testimonial",
      1,
      CONTENT_SCHEMAS.testimonial.parse({ ...input, consent: true }),
      NOW,
    );
    expect(agreed.ok).toBe(true);
    expect((await publishContent(db(), created.doc._id, 2, NOW)).ok).toBe(true);
    expect((await loadContent(db(), "published")).testimonials).toEqual([
      {
        id: created.doc._id.toHexString(),
        quote: "Delivered early and explained everything.",
        name: "Ada Lovelace",
        role: "Founder, Analytical Engines",
        workSlug: "leffloard-xyz",
      },
    ]);
  });
});

describe("taking down, ordering and deleting", () => {
  it("unpublishes, reorders and deletes with the site following", async () => {
    await seedContent(db(), NOW);
    const before = (await loadContent(db(), "published")).work.map((item) => item.slug);
    const second = (await contentItems(db()).findOne({ kind: "work", key: before[1]! }))!;

    expect(await moveContent(db(), second._id, "up")).toBe(true);
    const moved = (await loadContent(db(), "published")).work.map((item) => item.slug);
    expect(moved.slice(0, 2)).toEqual([before[1], before[0]]);

    expect(await unpublishContent(db(), second._id, NOW)).toBe(true);
    expect((await loadContent(db(), "published")).work.map((item) => item.slug)).not.toContain(before[1]);
    expect((await getContent(db(), second._id))?.draft).toMatchObject({ slug: before[1] });
    expect(await contentVersions(db()).countDocuments({ contentId: second._id })).toBe(1);

    expect(await deleteContent(db(), second._id)).toBe(true);
    expect(await getContent(db(), second._id)).toBeNull();
    expect(await contentVersions(db()).countDocuments({ contentId: second._id })).toBe(0);

    const profile = (await getSingleton(db(), "profile"))!;
    expect(await deleteContent(db(), profile._id)).toBe(false);
    expect(await unpublishContent(db(), profile._id)).toBe(false);
    expect(((await contentState(db()).findOne({ _id: "site" }))?.generation ?? 0) > 1).toBe(true);
  });
});

describe("scheduled publishing", () => {
  it("publishes what is due once, and tells the owner about a draft that fails its checks", async () => {
    await seedContent(db(), NOW);
    const good = await createContent(db(), "post", post(), NOW);
    const bad = await createContent(
      db(),
      "post",
      post({ slug: "leaky", body: "SMTP_PASSWORD=hunter2hunter2" }),
      NOW,
    );
    if (!good.ok || !bad.ok) throw new Error("not created");
    expect((await scheduleContent(db(), good.doc._id, 1, LATER)).ok).toBe(true);
    // The check runs when scheduling too.
    expect(await scheduleContent(db(), bad.doc._id, 1, LATER)).toMatchObject({ ok: false, reason: "leaks" });
    await contentItems(db()).updateOne({ _id: bad.doc._id }, { $set: { publishAt: LATER } });

    const notify = { siteUrl: "https://leffloard.test", channels: readChannels() };
    expect(await publishDue(db(), notify, NOW)).toEqual({ published: 0, failed: 0 });
    const [first, second] = await Promise.all([
      publishDue(db(), notify, LATER),
      publishDue(db(), notify, LATER),
    ]);
    expect(first.published + second.published).toBe(1);
    expect(first.failed + second.failed).toBe(1);

    expect((await getContent(db(), good.doc._id))?.published).toMatchObject({ slug: "shipping-the-portal" });
    expect(await listVersions(db(), good.doc._id)).toEqual([]);
    const failed = (await getContent(db(), bad.doc._id))!;
    expect(failed.published).toBeNull();
    expect(failed.publishAt).toBeNull();
    const alerts = await db().collection<OutboxDoc>("outbox").find().toArray();
    expect(alerts.map((alert) => alert.label)).toEqual([
      "Scheduled publishing failed: Shipping the client portal",
    ]);
    expect((alerts[0]!.payload as { text: string }).text).toContain("a secret from a settings file");
  });
});

describe("the owner's preview", () => {
  async function adminSession(id: string, lastSeenAt: Date = NOW) {
    await db()
      .collection<{ _id: string; [field: string]: unknown }>("sessions")
      .insertOne({ _id: id, lastSeenAt, expiresAt: new Date(NOW.getTime() + 12 * 3600_000) });
  }

  it("lasts an hour, and ends on exit", async () => {
    await adminSession("session-1");
    const token = await startPreview(db(), "session-1", NOW);
    expect(await previewKeyValid(db(), token, NOW)).toBe(true);
    expect(await previewKeyValid(db(), token, new Date(NOW.getTime() + 61 * 60_000))).toBe(false);
    expect(await previewKeyValid(db(), "not-a-real-key-at-all-000", NOW)).toBe(false);
    await endPreview(db(), token);
    expect(await previewKeyValid(db(), token, NOW)).toBe(false);
  });

  it("ends with the admin session that asked for it", async () => {
    await adminSession("session-2");
    const token = await startPreview(db(), "session-2", NOW);
    // An idle session (30 minutes without the admin) ends the preview too.
    expect(await previewKeyValid(db(), token, new Date(NOW.getTime() + 31 * 60_000))).toBe(false);
    expect(await previewKeyValid(db(), token, NOW)).toBe(true);
    await db()
      .collection("sessions")
      .deleteOne({ _id: "session-2" as never });
    expect(await previewKeyValid(db(), token, NOW)).toBe(false);
  });
});
