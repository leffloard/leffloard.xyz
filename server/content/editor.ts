import "server-only";
import { isDeepStrictEqual } from "node:util";
import { MongoServerError, ObjectId, type ClientSession, type Db } from "mongodb";
import { checkedText, findLeaks, type LeakFinding } from "@/lib/content/leaks";
import {
  CONTENT_SCHEMAS,
  KIND_LABELS,
  type ContentData,
  type ContentKind,
  type ListKind,
  type SingletonKind,
} from "@/lib/content/schemas";
import type { Stored } from "@/lib/content/types";
import { rankBetween } from "@/lib/rank";
import { now } from "@/server/clock";
import { contentItems, contentVersions, contentWrites, githubRepos } from "@/server/content/collections";
import { renderStored } from "@/server/content/render";
import { forgetContent } from "@/server/content/snapshot";
import { bumpGeneration } from "@/server/content/store";
import type { ContentDoc, ContentVersionDoc } from "@/server/content/types";
import { inTransaction } from "@/server/db/transaction";
import { alertOwner } from "@/server/notify/owner";
import type { Channels } from "@/server/notify/channels";
import { discordSafe, headerText } from "@/server/notify/escape";

// The content editor's changes. A save only touches the draft; publishing checks the draft for leaks and
// copies it over the published copy in one transaction, keeping the replaced copy as a version and raising
// the content's generation so every server process shows the change.

const DUPLICATE_KEY = 11000;
const SLUG_TAKEN = "Another item already uses this address.";

function isDuplicate(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === DUPLICATE_KEY;
}

// --- Settings: the owner's own words for the leak check ------------------------------------------------------

type ContentSettingsDoc = { _id: "content"; bannedWords: string[]; version: number; updatedAt: Date };

function contentSettings(db: Db) {
  return db.collection<ContentSettingsDoc>("settings");
}

export async function getContentSettings(db: Db): Promise<{ bannedWords: string[]; version: number }> {
  const doc = await contentSettings(db).findOne({ _id: "content" });
  return { bannedWords: doc?.bannedWords ?? [], version: doc?.version ?? 0 };
}

export async function saveContentSettings(
  db: Db,
  bannedWords: string[],
  version: number,
  at: Date = now(),
): Promise<boolean> {
  try {
    const result = await contentSettings(db).updateOne(
      { _id: "content", version },
      { $set: { bannedWords, updatedAt: at }, $inc: { version: 1 } },
      { upsert: version === 0 },
    );
    return result.matchedCount === 1 || result.upsertedCount === 1;
  } catch (error) {
    if (isDuplicate(error)) return false; // saved from another tab first
    throw error;
  }
}

// --- Reading ---------------------------------------------------------------------------------------------------

export type ContentStatus = "draft" | "published" | "changed" | "scheduled";

export function contentStatus(doc: Pick<ContentDoc, "publishAt" | "published" | "changed">): ContentStatus {
  if (doc.publishAt) return "scheduled";
  if (!doc.published) return "draft";
  return doc.changed ? "changed" : "published";
}

export function contentTitle(doc: ContentDoc): string {
  switch (doc.kind) {
    case "work":
    case "post":
    case "service":
      return doc.draft.title;
    case "testimonial":
      return doc.draft.name;
    default:
      return KIND_LABELS[doc.kind].one;
  }
}

export async function listContent(db: Db, kind: ListKind): Promise<ContentDoc[]> {
  return contentItems(db).find({ kind }).sort({ rank: 1 }).limit(500).toArray();
}

export async function getContent(db: Db, id: ObjectId): Promise<ContentDoc | null> {
  return contentItems(db).findOne({ _id: id });
}

export async function getSingleton(db: Db, kind: SingletonKind): Promise<ContentDoc | null> {
  return contentItems(db).findOne({ kind, key: kind });
}

export async function listVersions(db: Db, id: ObjectId): Promise<ContentVersionDoc[]> {
  return contentVersions(db).find({ contentId: id }).sort({ replacedAt: -1 }).limit(20).toArray();
}

// --- Drafts ----------------------------------------------------------------------------------------------------

export type SaveResult =
  | { ok: true; doc: ContentDoc }
  | { ok: false; reason: "missing" | "conflict" }
  | { ok: false; reason: "field"; field: string; message: string };

async function slugTaken(db: Db, kind: ContentKind, slug: string, except?: ObjectId): Promise<boolean> {
  const found = await contentItems(db).findOne(
    { kind, ...(except ? { _id: { $ne: except } } : {}), $or: [{ key: slug }, { "published.slug": slug }] },
    { projection: { _id: 1 } },
  );
  return found !== null;
}

function slugOf(data: unknown): string | null {
  return data && typeof data === "object" && "slug" in data && typeof data.slug === "string"
    ? data.slug
    : null;
}

export async function createContent<K extends ListKind>(
  db: Db,
  kind: K,
  data: ContentData[K],
  at: Date = now(),
): Promise<SaveResult> {
  const _id = new ObjectId();
  const slug = slugOf(data);
  if (slug && (await slugTaken(db, kind, slug)))
    return { ok: false, reason: "field", field: "slug", message: SLUG_TAKEN };
  const last = await contentItems(db)
    .find({ kind }, { projection: { rank: 1 } })
    .sort({ rank: -1 })
    .limit(1)
    .next();
  const doc = {
    _id,
    kind,
    key: slug ?? _id.toHexString(),
    draft: await renderStored(kind, data),
    published: null,
    publishedAt: null,
    publishAt: null,
    changed: true,
    rank: rankBetween(last?.rank ?? null, null),
    version: 1,
    createdAt: at,
    updatedAt: at,
  } as ContentDoc;
  try {
    await contentItems(db).insertOne(doc);
  } catch (error) {
    if (isDuplicate(error)) return { ok: false, reason: "field", field: "slug", message: SLUG_TAKEN };
    throw error;
  }
  return { ok: true, doc };
}

export async function saveDraft<K extends ContentKind>(
  db: Db,
  id: ObjectId,
  kind: K,
  version: number,
  data: ContentData[K],
  at: Date = now(),
): Promise<SaveResult> {
  const current = await contentItems(db).findOne({ _id: id, kind });
  if (!current) return { ok: false, reason: "missing" };
  const slug = slugOf(data);
  if (slug && slug !== current.key && (await slugTaken(db, kind, slug, id))) {
    return { ok: false, reason: "field", field: "slug", message: SLUG_TAKEN };
  }
  const draft = await renderStored(kind, data);
  try {
    const doc = (await contentWrites(db).findOneAndUpdate(
      { _id: id, version },
      {
        $set: {
          draft,
          key: slug ?? current.key,
          changed: !isDeepStrictEqual(draft, current.published),
          updatedAt: at,
        },
        $inc: { version: 1 },
      },
      { returnDocument: "after" },
    )) as ContentDoc | null;
    return doc ? { ok: true, doc } : { ok: false, reason: "conflict" };
  } catch (error) {
    if (isDuplicate(error)) return { ok: false, reason: "field", field: "slug", message: SLUG_TAKEN };
    throw error;
  }
}

// Brings a replaced copy back into the draft (to publish again, or edit first).
export async function restoreVersion(
  db: Db,
  id: ObjectId,
  versionId: ObjectId,
  version: number,
  at: Date = now(),
): Promise<SaveResult> {
  const [current, old] = await Promise.all([
    contentItems(db).findOne({ _id: id }),
    contentVersions(db).findOne({ _id: versionId, contentId: id }),
  ]);
  if (!current || !old) return { ok: false, reason: "missing" };
  // Checked by today's rules and rendered again, like any draft: a kept copy is never trusted as it is.
  const parsed = CONTENT_SCHEMAS[current.kind].safeParse(contentInput(current.kind, old.data));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      reason: "field",
      field: "form",
      message: `This version no longer passes today's rules (${issue?.path.join(".") || "the form"}: ${issue?.message}). Copy what you need from it instead.`,
    };
  }
  const draft = await renderStored(current.kind, parsed.data as never);
  const slug = slugOf(draft);
  if (slug && slug !== current.key && (await slugTaken(db, current.kind, slug, id))) {
    return { ok: false, reason: "field", field: "slug", message: SLUG_TAKEN };
  }
  const doc = (await contentWrites(db).findOneAndUpdate(
    { _id: id, version },
    {
      $set: {
        draft,
        key: slug ?? current.key,
        changed: !isDeepStrictEqual(draft, current.published),
        updatedAt: at,
      },
      $inc: { version: 1 },
    },
    { returnDocument: "after" },
  )) as ContentDoc | null;
  return doc ? { ok: true, doc } : { ok: false, reason: "conflict" };
}

function without(data: object, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([key]) => !keys.includes(key)));
}

// A stored copy as the editor's input: what the owner wrote, without what the server rendered from it.
export function contentInput(kind: ContentKind, stored: unknown): Record<string, unknown> {
  const data = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  switch (kind) {
    case "work":
      return { ...without(data, ["lead", "sections"]), repo: data.repo ?? "" };
    case "post":
      return without(data, ["html", "headings", "readingMinutes"]);
    case "testimonial":
      return { ...data, workSlug: data.workSlug ?? "" };
    default:
      return { ...data };
  }
}

// --- Publishing ------------------------------------------------------------------------------------------------

export type PublishResult =
  | { ok: true; doc: ContentDoc }
  | { ok: false; reason: "missing" | "conflict" | "consent" | "slug" }
  | { ok: false; reason: "leaks"; findings: LeakFinding[] };

// What stops a draft from going live: a leak, a testimonial without permission.
export async function publishProblems(db: Db, doc: ContentDoc): Promise<PublishResult | null> {
  if (doc.kind === "testimonial" && !doc.draft.consent) return { ok: false, reason: "consent" };
  const { bannedWords } = await getContentSettings(db);
  const findings = findLeaks(checkedText(doc.draft), bannedWords);
  return findings.length ? { ok: false, reason: "leaks", findings } : null;
}

async function keepVersion(db: Db, doc: ContentDoc, at: Date, session: ClientSession): Promise<void> {
  if (!doc.published) return;
  await contentVersions(db).insertOne(
    {
      _id: new ObjectId(),
      contentId: doc._id,
      kind: doc.kind,
      key: doc.key,
      data: doc.published as Stored[ContentKind],
      publishedAt: doc.publishedAt ?? doc.createdAt,
      replacedAt: at,
    },
    { session },
  );
}

// Publishes the draft as it was read at `version` (a newer save in between refuses, rather than publishing
// something the owner has not looked at).
export async function publishContent(
  db: Db,
  id: ObjectId,
  version: number,
  at: Date = now(),
): Promise<PublishResult> {
  const current = await getContent(db, id);
  if (!current) return { ok: false, reason: "missing" };
  if (current.version !== version) return { ok: false, reason: "conflict" };
  const problem = await publishProblems(db, current);
  if (problem) return problem;
  const slug = slugOf(current.draft);
  if (slug) {
    const clash = await contentItems(db).findOne(
      { kind: current.kind, _id: { $ne: id }, "published.slug": slug },
      { projection: { _id: 1 } },
    );
    if (clash) return { ok: false, reason: "slug" };
  }
  try {
    const doc = await inTransaction(db, async (session) => {
      const updated = (await contentWrites(db).findOneAndUpdate(
        { _id: id, version },
        {
          $set: { published: current.draft, publishedAt: at, publishAt: null, changed: false, updatedAt: at },
        },
        { session, returnDocument: "after" },
      )) as ContentDoc | null;
      if (!updated) return null;
      await keepVersion(db, current, at, session);
      await bumpGeneration(db, session, at);
      return updated;
    });
    if (!doc) return { ok: false, reason: "conflict" };
    forgetContent();
    return { ok: true, doc };
  } catch (error) {
    if (isDuplicate(error)) return { ok: false, reason: "slug" };
    throw error;
  }
}

// Takes an item off the site; its draft stays, and the published copy is kept as a version.
export async function unpublishContent(db: Db, id: ObjectId, at: Date = now()): Promise<boolean> {
  const current = await getContent(db, id);
  if (!current || current.kind === "profile" || current.kind === "cv" || current.kind === "pricing")
    return false;
  if (!current.published) return true;
  await inTransaction(db, async (session) => {
    await contentItems(db).updateOne(
      { _id: id },
      { $set: { published: null, publishedAt: null, publishAt: null, changed: true, updatedAt: at } },
      { session },
    );
    await keepVersion(db, current, at, session);
    await bumpGeneration(db, session, at);
  });
  forgetContent();
  return true;
}

// Publishes the draft at a later moment (the content job checks every minute). The leak check runs now as
// well, so a problem shows while the owner is still here.
export async function scheduleContent(
  db: Db,
  id: ObjectId,
  version: number,
  publishAt: Date | null,
): Promise<PublishResult> {
  const current = await getContent(db, id);
  if (!current) return { ok: false, reason: "missing" };
  if (current.version !== version) return { ok: false, reason: "conflict" };
  if (publishAt) {
    const problem = await publishProblems(db, current);
    if (problem) return problem;
  }
  const doc = await contentItems(db).findOneAndUpdate(
    { _id: id, version },
    { $set: { publishAt } },
    { returnDocument: "after" },
  );
  return doc ? { ok: true, doc } : { ok: false, reason: "conflict" };
}

export async function deleteContent(db: Db, id: ObjectId): Promise<boolean> {
  const current = await getContent(db, id);
  if (!current || current.kind === "profile" || current.kind === "cv" || current.kind === "pricing")
    return false;
  await inTransaction(db, async (session) => {
    await contentItems(db).deleteOne({ _id: id }, { session });
    await contentVersions(db).deleteMany({ contentId: id }, { session });
    if (current.published) await bumpGeneration(db, session);
  });
  if (current.published) forgetContent();
  return true;
}

// Moves an item one place up or down in its kind's order (which the site follows).
export async function moveContent(db: Db, id: ObjectId, direction: "up" | "down"): Promise<boolean> {
  const current = await getContent(db, id);
  if (!current) return false;
  const neighbour = await contentItems(db)
    .find({ kind: current.kind, rank: direction === "up" ? { $lt: current.rank } : { $gt: current.rank } })
    .sort({ rank: direction === "up" ? -1 : 1 })
    .limit(1)
    .next();
  if (!neighbour) return true;
  await inTransaction(db, async (session) => {
    await contentItems(db).updateOne({ _id: current._id }, { $set: { rank: neighbour.rank } }, { session });
    await contentItems(db).updateOne({ _id: neighbour._id }, { $set: { rank: current.rank } }, { session });
    if (current.published || neighbour.published) await bumpGeneration(db, session);
  });
  forgetContent();
  return true;
}

// --- Scheduled publishing (the content job) -----------------------------------------------------------------------

function scheduleProblemText(title: string, result: Exclude<PublishResult, { ok: true }>): string {
  if (result.reason === "leaks") {
    return `"${title}" was not published: the leak check found ${result.findings
      .map((finding) => finding.label.toLowerCase())
      .join(", ")}. Edit it and publish again.`;
  }
  if (result.reason === "consent")
    return `"${title}" was not published: the person's permission is not recorded.`;
  if (result.reason === "slug") return `"${title}" was not published: another item already uses its address.`;
  return `"${title}" was not published: it changed or was removed.`;
}

// Publishes what is due. A draft that fails its checks is not published; the schedule is cleared and the
// owner is told once.
export async function publishDue(
  db: Db,
  notify: { siteUrl: string; channels: Channels },
  at: Date = now(),
): Promise<{ published: number; failed: number }> {
  const due = await contentItems(db)
    .find({ publishAt: { $lte: at } })
    .limit(20)
    .toArray();
  let published = 0;
  let failed = 0;
  for (const doc of due) {
    // Claimed first, so two server processes never publish the same item twice.
    const claimed = await contentItems(db).updateOne(
      { _id: doc._id, publishAt: doc.publishAt },
      { $set: { publishAt: null } },
    );
    if (!claimed.modifiedCount) continue;
    let result: PublishResult;
    try {
      result = await publishContent(db, doc._id, doc.version, at);
    } catch (error) {
      // Not the draft's fault (the database was unreachable): the schedule is put back and tried again.
      await contentItems(db).updateOne(
        { _id: doc._id, publishAt: null },
        { $set: { publishAt: doc.publishAt } },
      );
      throw error;
    }
    if (result.ok) {
      published += 1;
      continue;
    }
    failed += 1;
    const title = contentTitle(doc);
    const text = scheduleProblemText(title, result);
    const url = `${notify.siteUrl}/admin/content/${doc.kind}/${doc._id.toHexString()}`;
    const key = `content:schedule:${doc._id.toHexString()}:${doc.publishAt?.toISOString()}`;
    await alertOwner(
      db,
      notify.channels,
      {
        kind: "problem",
        key,
        label: `Scheduled publishing failed: ${title}`,
        title: `Scheduled publishing failed: ${title}`,
        body: text,
        href: `/admin/content/${doc.kind}/${doc._id.toHexString()}`,
        email: (to) => ({
          to: [{ address: to }],
          subject: headerText(`Scheduled publishing failed: ${title}`),
          text: `${text}\n\nOpen it: ${url}\n`,
        }),
        discord: () => ({
          embeds: [
            {
              title: "Scheduled publishing failed",
              color: 0xf59e0b,
              description: discordSafe(text, 1500),
              fields: [{ name: "Edit", value: `[Open it](${url})`, inline: false }],
              footer: { text: "leffloard.xyz content" },
              timestamp: at.toISOString(),
              url,
            },
          ],
          allowed_mentions: { parse: [] },
        }),
      },
      at,
    );
  }
  return { published, failed };
}

// --- A check of everything ---------------------------------------------------------------------------------

export type ScanRow = {
  id: string;
  kind: ContentKind | "repository";
  title: string;
  copy: "published" | "draft";
  findings: LeakFinding[];
};

// The leak check over every published copy, every draft that differs from it, and the repositories on the
// work page: for words added to the list after something was published (Content → Leak check, and
// `npm run content:lint`).
export async function scanContent(db: Db): Promise<ScanRow[]> {
  const [docs, { bannedWords }, repos] = await Promise.all([
    contentItems(db).find().limit(2000).toArray(),
    getContentSettings(db),
    githubRepos(db)
      .find({ show: true }, { projection: { name: 1, description: 1 } })
      .toArray(),
  ]);
  const rows: ScanRow[] = [];
  for (const doc of docs) {
    for (const copy of ["published", "draft"] as const) {
      const data = copy === "published" ? doc.published : doc.draft;
      if (!data || (copy === "draft" && doc.published && !doc.changed)) continue;
      const findings = findLeaks(checkedText(data), bannedWords);
      if (findings.length) {
        rows.push({ id: doc._id.toHexString(), kind: doc.kind, title: contentTitle(doc), copy, findings });
      }
    }
  }
  for (const repo of repos) {
    const findings = findLeaks(`${repo.name}\n${repo.description}`, bannedWords);
    if (findings.length)
      rows.push({ id: repo._id, kind: "repository", title: repo.name, copy: "published", findings });
  }
  return rows;
}
