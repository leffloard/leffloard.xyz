import { BackupsCard } from "@/components/admin/settings/cards";
import { PageHeader } from "@/components/admin/shell";
import { ClearButton } from "@/components/admin/system/clear-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatBytes, formatDateTime, formatRelative, plural } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { backupStatus } from "@/server/backup/service";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { getEnv, readEnv } from "@/server/env";
import { listJobs } from "@/server/jobs/runner";
import { errorGroups } from "@/server/system/errors";
import { cspGroups, databaseStatus, integrations, serverStatus } from "@/server/system/status";

export const metadata = { title: "System" };

// Atlas's free cluster holds 512 MB, indexes included.
const FREE_TIER_BYTES = 512 * 1024 * 1024;

function duration(seconds: number): string {
  if (seconds < 3600) return plural(Math.max(1, Math.round(seconds / 60)), "minute");
  if (seconds < 86_400) return plural(Math.round(seconds / 3600), "hour");
  return plural(Math.round(seconds / 86_400), "day");
}

function Row({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <li className="flex items-baseline justify-between gap-4">
      <span className="flex items-center gap-2">
        <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${ok ? "bg-success" : "bg-warning"}`} />
        {label}
      </span>
      <span className={`text-right break-words ${ok ? "text-muted" : "text-warning"}`}>{detail}</span>
    </li>
  );
}

export default async function SystemPage() {
  await requireAdmin();
  const db = await getDb();
  const at = now();
  const env = getEnv();
  const [database, jobs, backups, errors, csp] = await Promise.all([
    databaseStatus(db),
    listJobs(db),
    backupStatus(db),
    errorGroups(db),
    cspGroups(db),
  ]);
  const server = serverStatus();
  const warnings = readEnv().warnings;
  const used = database.size ? database.size.storage + database.size.indexes : null;
  const lastBackup = backups.last;

  return (
    <>
      <PageHeader
        title="System"
        description="The server and its database, background jobs, backups, and problems the site noticed."
      />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader title="Health" />
          <CardBody>
            <ul className="grid gap-2.5 text-[13px]">
              <Row
                label="Database"
                ok={database.error === null}
                detail={database.error ?? `answers in ${database.pingMs} ms`}
              />
              <Row
                label="Migrations"
                ok={database.pending.length === 0}
                detail={database.pending.length ? `pending: ${database.pending.join(", ")}` : "up to date"}
              />
              <Row label="Release" ok detail={`${server.version}, Node ${server.node}`} />
              <Row label="Running for" ok detail={duration(server.uptimeSeconds)} />
              <Row label="Memory" ok detail={formatBytes(server.memoryBytes)} />
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Storage"
            description={
              used === null
                ? "The database didn't report its size."
                : `${formatBytes(used)} on disk with indexes${
                    used > FREE_TIER_BYTES * 0.8 ? ": close to the 512 MB of Atlas's free cluster" : ""
                  }.`
            }
          />
          <CardBody>
            {database.collections.length ? (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-xs text-muted">
                    <th scope="col" className="pb-1.5 text-left font-normal">
                      Collection
                    </th>
                    <th scope="col" className="pb-1.5 text-right font-normal">
                      Documents
                    </th>
                    <th scope="col" className="pb-1.5 text-right font-normal">
                      Size
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {database.collections.slice(0, 10).map((collection) => (
                    <tr key={collection.name}>
                      <td className="py-0.5 font-mono text-xs">{collection.name}</td>
                      <td className="py-0.5 text-right font-mono text-xs tabular-nums">
                        {collection.documents.toLocaleString("en-US")}
                      </td>
                      <td className="py-0.5 text-right font-mono text-xs tabular-nums">
                        {collection.bytes === null ? "–" : formatBytes(collection.bytes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-[13px] text-muted">No collections yet.</p>
            )}
          </CardBody>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader
            title="Configuration"
            description="Set in the server's environment; changes need a restart."
          />
          <CardBody className="grid gap-4 text-[13px]">
            <ul className="grid gap-2.5">
              {integrations(env).map((row) => (
                <Row key={row.label} label={row.label} ok={row.on} detail={row.detail} />
              ))}
            </ul>
            {warnings.length ? (
              <ul className="grid gap-1 border-t border-line pt-3">
                {warnings.map((warning) => (
                  <li key={warning} className="text-warning">
                    {warning}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader
            title="Background jobs"
            description="What the server runs on its own, and how it went last time."
          />
          <CardBody>
            {jobs.length === 0 ? (
              <p className="text-[13px] text-muted">No job has run yet.</p>
            ) : (
              <ul className="divide-y divide-line text-[13px]">
                {jobs.map((job) => (
                  <li key={job._id} className="grid gap-0.5 py-2 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{job._id}</span>
                      {job.lastOk === null ? null : (
                        <Badge tone={job.lastOk ? "success" : "danger"}>{job.lastOk ? "ok" : "failed"}</Badge>
                      )}
                      <span className="ml-auto text-xs text-muted">
                        {job.lastFinishedAt
                          ? `last run ${formatRelative(job.lastFinishedAt, at)}`
                          : "not run yet"}
                      </span>
                    </div>
                    {job.lastMessage ? (
                      <p className="text-xs break-words text-muted">{job.lastMessage}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <div className="md:col-span-2">
          <BackupsCard
            state={backups.state}
            folder={backups.dir}
            keep={backups.keep}
            lastRun={
              lastBackup?.lastFinishedAt
                ? `${formatRelative(lastBackup.lastFinishedAt, at)}: ${lastBackup.lastOk ? "" : "failed: "}${lastBackup.lastMessage ?? ""}`
                : null
            }
            files={backups.files.slice(0, 10).map((file) => ({
              name: file.name,
              size: formatBytes(file.bytes),
              when: formatDateTime(file.modifiedAt),
            }))}
          />
        </div>

        <Card className="md:col-span-2">
          <CardHeader
            title="Errors"
            description={
              errors.length
                ? "What the server logged as errors in the last 30 days, the latest first."
                : "No errors in the last 30 days."
            }
            action={<ClearButton what="errors" label="Clear the error log" empty={errors.length === 0} />}
          />
          {errors.length ? (
            <CardBody>
              <ul className="divide-y divide-line text-[13px]">
                {errors.map((group) => (
                  <li
                    key={`${group.message}-${group.type}`}
                    className="grid gap-1 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium break-words">{group.message}</span>
                      {group.count > 1 ? <Badge>{group.count}×</Badge> : null}
                      <span className="ml-auto text-xs text-muted">{formatRelative(group.lastAt, at)}</span>
                    </div>
                    {group.detail && group.detail !== group.message ? (
                      <p className="text-xs break-words text-muted">
                        {group.type ? `${group.type}: ` : ""}
                        {group.detail}
                      </p>
                    ) : null}
                    {Object.keys(group.context).length ? (
                      <p className="font-mono text-[11px] text-muted">
                        {Object.entries(group.context)
                          .map(([key, value]) => `${key}=${value}`)
                          .join(" ")}
                      </p>
                    ) : null}
                    {group.stack ? (
                      <details>
                        <summary className="cursor-pointer text-xs text-muted">Stack trace</summary>
                        <pre className="mt-1 overflow-x-auto font-mono text-[11px] whitespace-pre text-muted">
                          {group.stack}
                        </pre>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardBody>
          ) : null}
        </Card>

        <Card className="md:col-span-2">
          <CardHeader
            title="Content Security Policy reports"
            description={
              csp.length
                ? "Scripts, styles or frames a browser blocked on the site in the last 30 days. Browser extensions cause many of them."
                : "No browser reported a blocked script, style or frame in the last 30 days."
            }
            action={<ClearButton what="csp" label="Clear the reports" empty={csp.length === 0} />}
          />
          {csp.length ? (
            <CardBody>
              <ul className="divide-y divide-line text-[13px]">
                {csp.map((group) => (
                  <li
                    key={`${group.directive}-${group.blockedUrl}`}
                    className="grid gap-0.5 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-mono text-xs">{group.directive}</span>
                      <span className="min-w-0 font-mono text-xs break-all text-muted">
                        {group.blockedUrl || "(inline)"}
                      </span>
                      {group.count > 1 ? <Badge>{group.count}×</Badge> : null}
                      {group.disposition === "report" ? <Badge tone="neutral">report only</Badge> : null}
                      <span className="ml-auto text-xs text-muted">{formatRelative(group.lastAt, at)}</span>
                    </div>
                    <p className="text-xs break-all text-muted">
                      on {group.documentUrl || "an unknown page"}
                      {group.sourceFile ? `, from ${group.sourceFile}` : ""}
                      {group.sample ? `: ${group.sample}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </CardBody>
          ) : null}
        </Card>
      </div>
    </>
  );
}
