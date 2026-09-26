import Link from "next/link";
import { notFound } from "next/navigation";
import { ContentEditor } from "@/components/admin/content/content-editor";
import { PageHeader } from "@/components/admin/shell";
import { Notice } from "@/components/ui/notice";
import { KIND_LABELS } from "@/lib/content/schemas";
import { formatDateTime } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { kindParam } from "@/server/content/admin-pages";
import { contentTitle, getContent, listVersions } from "@/server/content/editor";
import { contentPaths, editorStatus, editorValue, versionRows, workOptions } from "@/server/content/view";
import { getDb } from "@/server/db/client";
import { parseId } from "@/server/work/collections";

export const metadata = { title: "Edit content" };

export default async function EditContentPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const { kind: rawKind, id: rawId } = await params;
  const kind = kindParam(rawKind);
  const id = parseId(rawId);
  if (!kind || !id) notFound();
  const db = await getDb();
  const doc = await getContent(db, id);
  if (!doc || doc.kind !== kind) notFound();
  const [versions, options] = await Promise.all([listVersions(db, doc._id), workOptions(db)]);
  const paths = contentPaths(doc);
  const created = (await searchParams).created === "1";
  return (
    <>
      <PageHeader
        title={contentTitle(doc)}
        description={
          <Link href={`/admin/content/${kind}`} className="hover:text-ink">
            ← {KIND_LABELS[kind].many}
          </Link>
        }
      />
      {created ? (
        <Notice tone="success" className="mb-6">
          Draft created. It stays off the site until you publish it.
        </Notice>
      ) : null}
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
      />
    </>
  );
}
