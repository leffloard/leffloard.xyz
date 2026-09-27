import { notFound } from "next/navigation";
import { ContentEditor } from "@/components/admin/content/content-editor";
import { PageHeader } from "@/components/admin/shell";
import { emptyContent } from "@/lib/content/fields";
import { KIND_LABELS, isListKind } from "@/lib/content/schemas";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { todayIn } from "@/lib/intake/time";
import { aiDisabledReason } from "@/server/ai/settings";
import { requireAdmin } from "@/server/auth/dal";
import { now } from "@/server/clock";
import { kindParam } from "@/server/content/admin-pages";
import { workOptions } from "@/server/content/view";
import { getDb } from "@/server/db/client";

export const metadata = { title: "New content" };

export default async function NewContentPage({ params }: { params: Promise<{ kind: string }> }) {
  await requireAdmin();
  const kind = kindParam((await params).kind);
  if (!kind || !isListKind(kind)) notFound();
  const db = await getDb();
  const [options, aiOff] = await Promise.all([workOptions(db), aiDisabledReason(db)]);
  return (
    <>
      <PageHeader title={`New ${KIND_LABELS[kind].one.toLowerCase()}`} />
      <ContentEditor
        kind={kind}
        id={null}
        version={0}
        initial={emptyContent(kind, todayIn(ADMIN_TIME_ZONE, now())) as Record<string, unknown>}
        status="new"
        publishedAt={null}
        publishAt={null}
        previewPath={null}
        livePath={null}
        workOptions={options}
        versions={[]}
        aiDisabledReason={aiOff}
      />
    </>
  );
}
