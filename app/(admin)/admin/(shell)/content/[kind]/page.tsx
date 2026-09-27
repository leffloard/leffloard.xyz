import Link from "next/link";
import { notFound } from "next/navigation";
import { ContentEditor } from "@/components/admin/content/content-editor";
import { ContentList } from "@/components/admin/content/content-list";
import { PageHeader } from "@/components/admin/shell";
import { buttonClasses } from "@/components/ui/button";
import { KIND_LABELS, isListKind } from "@/lib/content/schemas";
import { formatDateTime } from "@/lib/format";
import { aiDisabledReason } from "@/server/ai/settings";
import { requireAdmin } from "@/server/auth/dal";
import { kindParam } from "@/server/content/admin-pages";
import { getSingleton, listContent, listVersions } from "@/server/content/editor";
import {
  contentPaths,
  contentRow,
  editorStatus,
  editorValue,
  versionRows,
  workOptions,
} from "@/server/content/view";
import { getDb } from "@/server/db/client";

export const metadata = { title: "Content" };

// A kind's items (work, posts, services, testimonials), or the editor of a one-page kind (profile, CV,
// pricing terms).
export default async function ContentKindPage({ params }: { params: Promise<{ kind: string }> }) {
  await requireAdmin();
  const kind = kindParam((await params).kind);
  if (!kind) notFound();
  const db = await getDb();

  if (!isListKind(kind)) {
    const doc = await getSingleton(db, kind);
    if (!doc) notFound();
    const [versions, options, aiOff] = await Promise.all([
      listVersions(db, doc._id),
      workOptions(db),
      aiDisabledReason(db),
    ]);
    const paths = contentPaths(doc);
    return (
      <>
        <PageHeader title={KIND_LABELS[kind].one} />
        <ContentEditor
          kind={kind}
          id={doc._id.toHexString()}
          version={doc.version}
          initial={editorValue(doc)}
          status={editorStatus(doc)}
          publishedAt={doc.publishedAt ? formatDateTime(doc.publishedAt) : null}
          publishAt={doc.publishAt ? formatDateTime(doc.publishAt) : null}
          previewPath={paths.preview}
          livePath={paths.live}
          workOptions={options}
          versions={versionRows(versions)}
          aiDisabledReason={aiOff}
        />
      </>
    );
  }

  const docs = await listContent(db, kind);
  const rows = docs.map(contentRow);
  const sorted = kind === "post" ? [...rows].sort((a, b) => b.detail.localeCompare(a.detail)) : rows;
  return (
    <>
      <PageHeader
        title={KIND_LABELS[kind].many}
        description={
          kind === "post"
            ? "Newest first, as on the blog."
            : "In the order the site shows them; the arrows change it."
        }
        action={
          <Link href={`/admin/content/${kind}/new`} className={buttonClasses("primary", "sm")}>
            New {KIND_LABELS[kind].one.toLowerCase()}
          </Link>
        }
      />
      {sorted.length ? (
        <ContentList kind={kind} rows={sorted} ordered={kind !== "post"} />
      ) : (
        <p className="text-sm text-muted">Nothing here yet.</p>
      )}
    </>
  );
}
