import type { ReactNode } from "react";
import { Logo } from "@/components/admin/auth-frame";
import { AdminNav } from "@/components/admin/nav";
import { SignOutButton } from "@/components/admin/sign-out-button";

export function AdminShell({
  user,
  children,
}: {
  user: { name: string; email: string };
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface/40 lg:flex">
        <div className="flex h-14 items-center gap-2.5 border-b border-line px-4">
          <Logo className="size-6" />
          <span className="text-sm font-semibold tracking-tight">leffloard</span>
          <span className="ml-auto font-mono text-[10px] tracking-[0.08em] text-muted uppercase">admin</span>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-3">
          <AdminNav />
        </div>
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
          <details className="relative ml-auto">
            <summary className="flex h-8 cursor-pointer list-none items-center rounded-md border border-line-strong px-3 text-[13px] [&::-webkit-details-marker]:hidden">
              Menu
            </summary>
            <div className="absolute right-0 mt-2 w-60 rounded-lg border border-line bg-surface p-2 shadow-2xl shadow-black/50">
              <AdminNav />
              <SignOutButton className="mt-2 w-full" />
            </div>
          </details>
        </header>
        <main id="content" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          {children}
        </main>
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
