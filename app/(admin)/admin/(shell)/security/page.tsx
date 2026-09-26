import { PageHeader } from "@/components/admin/shell";
import { LockoutNotice } from "@/components/admin/security/lockout-card";
import { PasskeysCard } from "@/components/admin/security/passkeys-card";
import { PasswordCard } from "@/components/admin/security/password-card";
import { SessionsCard } from "@/components/admin/security/sessions-card";
import { TwoStepCard } from "@/components/admin/security/two-step-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { auditLabel, isWarningAction } from "@/lib/audit-labels";
import { formatDateTime, formatRelative, formatTime } from "@/lib/format";
import { recentAudit } from "@/server/auth/audit";
import { requireAdmin } from "@/server/auth/dal";
import { describeDevice } from "@/server/auth/devices";
import { listPasskeys } from "@/server/auth/passkeys";
import { listSessions } from "@/server/auth/sessions";
import { toPublicUser } from "@/server/auth/users";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { lockedUntil } from "@/server/security/lockout";

export const metadata = { title: "Security" };

const METHOD_NAMES: Record<string, string> = {
  password: "password",
  totp: "authenticator",
  recovery: "recovery code",
  passkey: "passkey",
};

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ recovery?: string }>;
}) {
  const { user, session } = await requireAdmin();
  const db = await getDb();
  const at = now();
  const [sessions, passkeys, activity, locked, params] = await Promise.all([
    listSessions(db, user._id),
    listPasskeys(db, user._id),
    recentAudit(db, { limit: 40 }),
    lockedUntil(db, user.email),
    searchParams,
  ]);
  const profile = toPublicUser(user);

  return (
    <>
      <PageHeader
        title="Security"
        description="How you sign in, where you are signed in, and what happened recently."
      />
      <div className="grid grid-cols-1 gap-6">
        {params.recovery === "used" ? (
          <Notice tone="warning">
            You signed in with a recovery code. {profile.recoveryCodesLeft} left. If your phone is gone, move
            the authenticator to a new phone below.
          </Notice>
        ) : null}
        {locked ? <LockoutNotice until={formatTime(locked)} /> : null}

        <SessionsCard
          sessions={sessions.map((entry) => ({
            id: entry._id,
            current: entry._id === session._id,
            device: describeDevice(entry.userAgent),
            ip: entry.ip,
            methods: entry.methods.map((method) => METHOD_NAMES[method] ?? method).join(" + "),
            signedIn: formatRelative(entry.createdAt, at),
            lastActive: formatRelative(entry.lastSeenAt, at),
          }))}
        />
        <TwoStepCard
          email={profile.email}
          totpSince={user.totp ? formatDateTime(user.totp.enabledAt) : "never"}
          recoveryCodesLeft={profile.recoveryCodesLeft}
        />
        <PasskeysCard
          passkeys={passkeys.map((passkey) => ({
            id: passkey._id,
            name: passkey.name,
            added: formatDateTime(passkey.createdAt),
            lastUsed: passkey.lastUsedAt ? formatRelative(passkey.lastUsedAt, at) : null,
            synced: passkey.backedUp,
          }))}
        />
        <PasswordCard changed={formatRelative(profile.passwordChangedAt, at)} />

        <Card>
          <CardHeader
            id="activity"
            title="Recent activity"
            description="Sign-ins and security changes, newest first. Kept in the database."
          />
          <CardBody className="p-0">
            {activity.length === 0 ? (
              <p className="px-5 py-4 text-[13px] text-muted">Nothing yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="text-xs text-muted">
                    <tr className="border-b border-line">
                      <th scope="col" className="px-5 py-2 font-medium">
                        Event
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        When
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        IP address
                      </th>
                      <th scope="col" className="px-5 py-2 font-medium">
                        Device
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {activity.map((event) => (
                      <tr key={event._id.toHexString()}>
                        <td className="px-5 py-2.5">
                          <span className={isWarningAction(event.action) ? "text-warning" : undefined}>
                            {auditLabel(event.action)}
                          </span>
                        </td>
                        <td
                          className="px-3 py-2.5 whitespace-nowrap text-muted"
                          title={formatDateTime(event.at)}
                        >
                          {formatRelative(event.at, at)}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-muted">{event.ip}</td>
                        <td className="px-5 py-2.5 text-muted">{describeDevice(event.userAgent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
