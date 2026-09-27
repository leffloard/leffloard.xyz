"use client";

import { useRouter } from "next/navigation";
import {
  markNotificationsReadAction,
  markNotificationUnreadAction,
  openNotificationAction,
} from "@/app/(admin)/admin/(shell)/notifications/actions";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Notice } from "@/components/ui/notice";

export type NotificationRow = {
  id: string;
  kind: string; // the kind's label
  title: string;
  body: string | null;
  href: string | null;
  when: string;
  unread: boolean;
};

// The notification centre's list. Opening one marks it read and goes to what it is about.
export function NotificationList({ rows, empty }: { rows: NotificationRow[]; empty: string }) {
  const router = useRouter();
  const { run, pending, message } = useActionRunner();
  const unread = rows.filter((row) => row.unread).length;

  async function open(row: NotificationRow) {
    const result = await run(`open:${row.id}`, () => openNotificationAction({ id: row.id }));
    if (result.ok && result.data.href) router.push(result.data.href);
    else router.refresh();
  }

  return (
    <div className="grid gap-3">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <span
                aria-hidden
                className={cn(
                  "mt-1.5 size-1.5 shrink-0 rounded-full",
                  row.unread ? "bg-accent" : "bg-transparent",
                )}
              />
              <div className="grid min-w-0 flex-1 gap-0.5">
                <button
                  type="button"
                  onClick={() => open(row)}
                  disabled={pending !== null}
                  className={cn(
                    "truncate text-left text-[13px] hover:text-accent disabled:opacity-60",
                    row.unread ? "font-semibold" : "text-muted",
                  )}
                >
                  {row.title}
                  {row.unread ? <span className="sr-only"> (unread)</span> : null}
                </button>
                {row.body ? <p className="line-clamp-2 text-xs break-words text-muted">{row.body}</p> : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge className="hidden sm:inline-flex">{row.kind}</Badge>
                <span className="text-xs text-muted">{row.when}</span>
                {row.unread ? (
                  <button
                    type="button"
                    className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
                    onClick={() =>
                      run(`read:${row.id}`, () => markNotificationsReadAction({ ids: [row.id] }))
                    }
                  >
                    Mark read<span className="sr-only">: {row.title}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
                    onClick={() =>
                      run(`unread:${row.id}`, () => markNotificationUnreadAction({ id: row.id }))
                    }
                  >
                    Mark unread<span className="sr-only">: {row.title}</span>
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {unread > 0 ? (
        <div>
          <Button
            size="sm"
            pending={pending === "all"}
            onClick={() => run("all", () => markNotificationsReadAction({}))}
          >
            Mark all as read
          </Button>
        </div>
      ) : null}
    </div>
  );
}
