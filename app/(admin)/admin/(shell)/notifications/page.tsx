import Link from "next/link";
import { NotificationList } from "@/components/admin/notifications/notification-list";
import { NotificationSettingsForm } from "@/components/admin/notifications/settings-form";
import { PageHeader } from "@/components/admin/shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { formatRelative, plural } from "@/lib/format";
import { ALERT_KIND_INFO } from "@/lib/notifications/model";
import { requireAdmin } from "@/server/auth/dal";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { readChannels } from "@/server/notify/channels";
import { countUnread, listNotifications } from "@/server/notify/owner";
import { getNotificationSettings } from "@/server/notify/settings";

export const metadata = { title: "Notifications" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const db = await getDb();
  const at = now();
  const showAll = first((await searchParams).show) === "all";
  const [rows, unread, settings] = await Promise.all([
    listNotifications(db, { unreadOnly: !showAll, limit: 100 }),
    countUnread(db),
    getNotificationSettings(db),
  ]);
  const channels = readChannels();
  const tabs = [
    {
      key: "unread",
      label: `Unread${unread ? ` (${unread >= 100 ? "99+" : unread})` : ""}`,
      href: "/admin/notifications",
    },
    { key: "all", label: "All", href: "/admin/notifications?show=all" },
  ];

  return (
    <>
      <PageHeader
        title="Notifications"
        description="New messages, calls, quote answers, payments, portal requests and problems. Kept for 90 days."
      />
      <div className="grid gap-6">
        <Card>
          <CardHeader
            title={showAll ? "All notifications" : "Unread"}
            description={
              showAll
                ? `The latest ${plural(rows.length, "notification")}.`
                : unread
                  ? `${plural(unread, "notification")} you haven't opened.`
                  : "You're up to date."
            }
            action={
              <nav aria-label="Show" className="flex gap-1.5">
                {tabs.map((tab) => {
                  const active = (tab.key === "all") === showAll;
                  return (
                    <Link
                      key={tab.key}
                      href={tab.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition-colors",
                        active ? "border-accent text-ink" : "border-line text-muted hover:text-ink",
                      )}
                    >
                      {tab.label}
                    </Link>
                  );
                })}
              </nav>
            }
          />
          <CardBody>
            <NotificationList
              rows={rows.map((row) => ({
                id: row._id.toHexString(),
                kind: ALERT_KIND_INFO[row.kind]?.label ?? row.kind,
                title: row.title,
                body: row.body,
                href: row.href,
                when: formatRelative(row.createdAt, at),
                unread: row.readAt === null,
              }))}
              empty={showAll ? "No notifications in the last 90 days." : "Nothing unread."}
            />
          </CardBody>
        </Card>
        <NotificationSettingsForm
          initial={{
            routes: settings.routes,
            quietEnabled: settings.quietEnabled,
            quietRanges: settings.quietRanges,
            digestEnabled: settings.digestEnabled,
            digestTime: settings.digestTime,
            version: settings.version,
          }}
          channels={{ email: channels.ownerEmail !== null, discord: channels.discordWebhookUrl !== null }}
        />
      </div>
    </>
  );
}
