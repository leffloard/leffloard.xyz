import { MediaGrid, MediaUpload, type MediaRow } from "@/components/admin/content/media-library";
import { PageHeader } from "@/components/admin/shell";
import { formatBytes, formatDate } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { listMedia } from "@/server/content/media";
import { getDb } from "@/server/db/client";

export const metadata = { title: "Media" };

export default async function MediaPage() {
  await requireAdmin();
  const media = await listMedia(await getDb());
  const rows: MediaRow[] = media.map((item) => ({
    id: item.id,
    src: item.src,
    width: item.width,
    height: item.height,
    size: formatBytes(item.size),
    alt: item.alt,
    name: item.name,
    added: formatDate(item.createdAt),
  }));
  return (
    <>
      <PageHeader
        title="Media"
        description="Images for case studies and posts. Paste an image's Markdown into the text where it should appear."
      />
      <div className="grid gap-6">
        <MediaUpload />
        <MediaGrid rows={rows} />
      </div>
    </>
  );
}
