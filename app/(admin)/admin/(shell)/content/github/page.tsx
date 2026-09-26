import { RepoList, SyncButton, type RepoRow } from "@/components/admin/content/github-repos";
import { PageHeader } from "@/components/admin/shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { GITHUB_USER, getGithubState, listRepos } from "@/server/content/github";
import { getDb } from "@/server/db/client";

export const metadata = { title: "GitHub" };

export default async function GithubPage() {
  await requireAdmin();
  const db = await getDb();
  const [state, repos] = await Promise.all([getGithubState(db), listRepos(db)]);
  const rows: RepoRow[] = repos.map((repo) => ({
    id: repo._id,
    name: repo.name,
    url: repo.url,
    description: repo.description,
    language: repo.language,
    stars: repo.stars,
    pushed: repo.pushedAt ? formatDate(repo.pushedAt) : null,
    fork: repo.fork,
    archived: repo.archived,
    show: repo.show,
  }));
  return (
    <>
      <PageHeader
        title="GitHub"
        description={`The public repositories of github.com/${GITHUB_USER}, read every six hours. Tick the ones the work page should list; a case study's repository shows its stars on its page either way.`}
      />
      <div className="grid gap-6">
        <Card>
          <CardHeader
            title="Last sync"
            description={
              state?.lastSyncAt
                ? `${formatDateTime(state.lastSyncAt)}: ${state.lastResult}`
                : "Not synced yet."
            }
          />
          <CardBody>
            <SyncButton />
          </CardBody>
        </Card>
        <RepoList rows={rows} />
      </div>
    </>
  );
}
