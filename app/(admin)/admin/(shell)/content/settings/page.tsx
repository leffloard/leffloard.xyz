import Link from "next/link";
import { LeakWordsForm } from "@/components/admin/content/settings-form";
import { PageHeader } from "@/components/admin/shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KIND_LABELS } from "@/lib/content/schemas";
import { requireAdmin } from "@/server/auth/dal";
import { getContentSettings, scanContent } from "@/server/content/editor";
import { getDb } from "@/server/db/client";

export const metadata = { title: "Leak check" };

export default async function LeakCheckPage() {
  await requireAdmin();
  const db = await getDb();
  const [settings, rows] = await Promise.all([getContentSettings(db), scanContent(db)]);
  return (
    <>
      <PageHeader
        title="Leak check"
        description="Every publication is checked first. Anything found stops it, with what was found."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <div className="grid content-start gap-6">
          <Card>
            <CardBody>
              <LeakWordsForm words={settings.bannedWords} version={settings.version} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Everything, checked now"
              description="The published site, the drafts and the repositories on the work page, with today's words."
            />
            <CardBody className="text-[13px]">
              {rows.length ? (
                <ul className="grid gap-3">
                  {rows.map((row) => (
                    <li key={`${row.id}-${row.copy}`} className="grid gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        {row.kind === "repository" ? (
                          <Link href="/admin/content/github" className="font-medium hover:text-accent">
                            {row.title}
                          </Link>
                        ) : (
                          <Link
                            href={
                              row.kind === "profile" || row.kind === "cv" || row.kind === "pricing"
                                ? `/admin/content/${row.kind}`
                                : `/admin/content/${row.kind}/${row.id}`
                            }
                            className="font-medium hover:text-accent"
                          >
                            {row.title}
                          </Link>
                        )}
                        <Badge tone={row.copy === "published" ? "warning" : "neutral"}>
                          {row.kind === "repository" ? "Repository" : KIND_LABELS[row.kind].one},{" "}
                          {row.copy === "published" ? "on the site" : "draft"}
                        </Badge>
                      </span>
                      <span className="text-muted">
                        {row.findings.map((finding) => `${finding.label}: ${finding.excerpt}`).join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">Nothing found.</p>
              )}
            </CardBody>
          </Card>
        </div>
        <Card>
          <CardHeader title="Always checked" />
          <CardBody className="text-[13px] text-muted">
            <ul className="grid list-disc gap-1 pl-5">
              <li>Discord webhooks and Discord ids</li>
              <li>Database addresses with a password</li>
              <li>API keys, tokens and private keys</li>
              <li>Secrets from settings files</li>
              <li>IP addresses (except local and documentation ones)</li>
              <li>Email addresses other than yours</li>
              <li>Phone numbers</li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
