import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/admin/auth-frame";
import { CommandPalette, PaletteButton } from "@/components/admin/command-palette";
import { AdminNav, type NavCounts } from "@/components/admin/nav";
import { SignOutButton } from "@/components/admin/sign-out-button";
import { TimerWidget, type RunningTimerView } from "@/components/admin/time/timer-widget";

export type ShellTimer = { running: RunningTimerView | null; projects: { id: string; label: string }[] };

// The bell: unread notifications, and the way to the notification centre.
function Bell({ unread }: { unread: number }) {
  return (
    <Link
      href="/admin/notifications"
      className="relative flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/[0.06] hover:text-ink"
    >
      <svg
        viewBox="0 0 20 20"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden
      >
        <path
          d="M5 13.5V9a5 5 0 0110 0v4.5l1.5 1.5h-13zM8.2 17a2 2 0 003.6 0"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="sr-only">Notifications{unread ? `, ${unread} unread` : ""}</span>
      {unread > 0 ? (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-accent px-1 text-center font-mono text-[10px] leading-4 font-semibold text-accent-ink"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}

export function AdminShell({
  user,
  counts,
  timer,
  unread = 0,
  children,
}: {
  user: { name: string; email: string };
  counts?: NavCounts;
  timer?: ShellTimer;
  unread?: number;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside
        aria-label="Sidebar"
        className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface/40 lg:flex"
      >
        <div className="flex h-14 items-center gap-2.5 border-b border-line px-4">
          <Logo className="size-6" />
          <span className="text-sm font-semibold tracking-tight">leffloard</span>
          <span className="ml-auto font-mono text-[10px] tracking-[0.08em] text-muted uppercase">admin</span>
          <Bell unread={unread} />
        </div>
        <div className="px-2 pt-3">
          <PaletteButton />
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-3">
          <AdminNav counts={counts} />
        </div>
        {timer ? (
          <div className="border-t border-line p-3">
            <TimerWidget running={timer.running} projects={timer.projects} />
          </div>
        ) : null}
        <div className="border-t border-line p-3">
          <p className="truncate text-[13px] font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted">{user.email}</p>
          <SignOutButton className="mt-2 w-full" />
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur lg:hidden">
          <Logo className="size-6" />
          <span className="text-sm font-semibold">leffloard</span>
          {timer?.running ? (
            <span className="ml-auto flex items-center gap-1.5 text-xs text-accent">
              <span
                aria-hidden
                className="size-2 animate-pulse rounded-full bg-accent motion-reduce:animate-none"
              />
              Timer on
            </span>
          ) : null}
          <div className={timer?.running ? undefined : "ml-auto"}>
            <Bell unread={unread} />
          </div>
          <details className="relative">
            <summary className="flex h-8 cursor-pointer list-none items-center rounded-md border border-line-strong px-3 text-[13px] [&::-webkit-details-marker]:hidden">
              Menu
            </summary>
            <div className="absolute right-0 mt-2 w-64 rounded-lg border border-line bg-surface p-2 shadow-2xl shadow-black/50">
              <PaletteButton className="mb-2" />
              <AdminNav counts={counts} />
              {timer ? (
                <div className="mt-2 border-t border-line pt-2">
                  <TimerWidget running={timer.running} projects={timer.projects} compact />
                </div>
              ) : null}
              <SignOutButton className="mt-2 w-full" />
            </div>
          </details>
        </header>
        <main id="content" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          {children}
        </main>
        <CommandPalette />
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
