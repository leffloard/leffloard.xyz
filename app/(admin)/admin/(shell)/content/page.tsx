import Link from "next/link";
import { PageHeader } from "@/components/admin/shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KIND_LABELS, LIST_KINDS, SINGLETON_KINDS } from "@/lib/content/schemas";
import { plural } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { contentItems } from "@/server/content/collections";
import { contentStatus } from "@/server/content/editor";
import { getDb } from "@/server/db/client";

export const metadata = { title: "Content" };

// Everything the public site shows, with what is waiting to be published.
export default async function ContentOverviewPage() {
  await requireAdmin();
  const db = await getDb();
  const docs = await contentItems(db)
    .find({}, { projection: { kind: 1, published: 1, changed: 1, publishAt: 1 } })
    .limit(2000)
    .toArray();
  const count = (kind: string, status: string) =>
    docs.filter((doc) => doc.kind === kind && contentStatus(doc) === status).length;

  return (
    <>
      <PageHeader
        title="Content"
        description="What the public site shows. Edit a draft, preview it, then publish: the site changes within seconds."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {LIST_KINDS.map((kind) => {
          const waiting = count(kind, "draft") + count(kind, "changed");
          const scheduled = count(kind, "scheduled");
          return (
            <Card key={kind}>
              <CardHeader
                title={KIND_LABELS[kind].many}
                description={[
                  `${count(kind, "published") + count(kind, "changed")} on the site`,
                  waiting ? `${plural(waiting, "draft")} not published` : null,
                  scheduled ? `${scheduled} scheduled` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                action={
                  <Link
                    href={`/admin/content/${kind}`}
                    className="text-[13px] text-accent underline-offset-4 hover:underline"
                  >
                    Open
                  </Link>
                }
              />
            </Card>
          );
        })}
        <Card className="md:col-span-2">
          <CardHeader title="About you" description="One page each, always on the site." />
          <CardBody className="flex flex-wrap gap-4 text-[13px]">
            {SINGLETON_KINDS.map((kind) => (
              <Link key={kind} href={`/admin/content/${kind}`} className="text-accent hover:underline">
                {KIND_LABELS[kind].one}
                {count(kind, "changed") ? " (changes not published)" : ""}
              </Link>
            ))}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
