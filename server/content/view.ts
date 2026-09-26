import "server-only";
import type { Db } from "mongodb";
import type { WorkOption } from "@/components/admin/content/content-form";
import type { EditorStatus, VersionRow } from "@/components/admin/content/content-editor";
import { formatDateTime } from "@/lib/format";
import { contentItems } from "@/server/content/collections";
import { contentInput, contentStatus, contentTitle } from "@/server/content/editor";
import type { ContentDoc, ContentVersionDoc } from "@/server/content/types";

// What the content editor's pages hand to the browser.

// The draft as the form edits it.
export function editorValue(doc: ContentDoc): Record<string, unknown> {
  return contentInput(doc.kind, doc.draft);
}

function pathOf(kind: ContentDoc["kind"], slug: string | undefined): string | null {
  switch (kind) {
    case "work":
      return slug ? `/work/${slug}` : null;
    case "post":
      return slug ? `/blog/${slug}` : null;
    case "service":
      return slug ? `/services/${slug}` : null;
    case "profile":
    case "testimonial":
      return "/";
    case "cv":
      return "/cv";
    case "pricing":
      return "/pricing";
  }
}

const slugOf = (data: unknown) =>
  data && typeof data === "object" && "slug" in data && typeof data.slug === "string" ? data.slug : undefined;

// Where the draft shows in a preview, and where the published copy is on the site.
export function contentPaths(doc: ContentDoc): { preview: string | null; live: string | null } {
  return {
    preview: pathOf(doc.kind, slugOf(doc.draft)),
    live: doc.published ? pathOf(doc.kind, slugOf(doc.published)) : null,
  };
}

export function editorStatus(doc: ContentDoc): EditorStatus {
  return contentStatus(doc);
}

export function versionRows(versions: ContentVersionDoc[]): VersionRow[] {
  return versions.map((version) => {
    const data = version.data as { title?: string; name?: string };
    return {
      id: version._id.toHexString(),
      label: data.title ?? data.name ?? "Earlier copy",
      publishedAt: formatDateTime(version.publishedAt),
      replacedAt: formatDateTime(version.replacedAt),
    };
  });
}

// The case studies a service, a skill or a testimonial can point to (by their draft's address).
export async function workOptions(db: Db): Promise<WorkOption[]> {
  const docs = await contentItems(db)
    .find({ kind: "work" }, { projection: { key: 1, "draft.title": 1, rank: 1 } })
    .sort({ rank: 1 })
    .toArray();
  return docs.map((doc) => ({ slug: doc.key, title: (doc.draft as { title: string }).title }));
}

export type ContentRow = {
  id: string;
  title: string;
  detail: string;
  status: EditorStatus;
  updated: string;
};

export function contentRow(doc: ContentDoc): ContentRow {
  const detail =
    doc.kind === "post"
      ? doc.draft.date
      : doc.kind === "work"
        ? `${doc.draft.kind} · ${doc.draft.year}`
        : doc.kind === "service"
          ? `${doc.draft.packages.length} packages`
          : doc.kind === "testimonial"
            ? doc.draft.role
            : "";
  return {
    id: doc._id.toHexString(),
    title: contentTitle(doc),
    detail,
    status: contentStatus(doc),
    updated: formatDateTime(doc.updatedAt),
  };
}
