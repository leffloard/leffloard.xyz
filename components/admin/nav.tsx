"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";

export type NavCounts = { inbox: number; tasks: number; calendar: number; billing: number };

type Item = { href: string; label: string; icon: string; count?: { key: keyof NavCounts; label: string } };

const ITEMS: Item[] = [
  { href: "/admin", label: "Today", icon: "M4 6h12M4 10h12M4 14h7" },
  {
    href: "/admin/inbox",
    label: "Inbox",
    icon: "M3 11l2.2-5.7A1.5 1.5 0 016.6 4.3h6.8a1.5 1.5 0 011.4 1L17 11v4.2a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 15.2zM3 11h4l1 2h4l1-2h4",
    count: { key: "inbox", label: " new" },
  },
  {
    href: "/admin/calendar",
    label: "Calendar",
    icon: "M4 5.5h12v10.5H4zM4 8.5h12M7.5 3.5v3M12.5 3.5v3",
    count: { key: "calendar", label: " waiting for an answer" },
  },
  {
    href: "/admin/tasks",
    label: "Tasks",
    icon: "M4 4.5h12v11H4zM7 10l2 2 4-4.5",
    count: { key: "tasks", label: " due" },
  },
  {
    href: "/admin/projects",
    label: "Projects",
    icon: "M3.5 4h3.5v12H3.5zM8.3 4h3.5v8H8.3zM13 4h3.5v5.5H13z",
  },
  {
    href: "/admin/clients",
    label: "Clients",
    icon: "M7.5 9a2.8 2.8 0 100-5.6 2.8 2.8 0 000 5.6zM2.5 16.5c0-2.8 2.2-5 5-5s5 2.2 5 5M13 3.6a2.7 2.7 0 010 5.2M14.6 11.8c1.7.6 2.9 2.4 2.9 4.7",
  },
  {
    href: "/admin/billing",
    label: "Billing",
    icon: "M5 3.5h10v13l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3zM7.5 7.5h5M7.5 10.5h5",
    count: { key: "billing", label: " overdue or to review" },
  },
  {
    href: "/admin/finance",
    label: "Finance",
    icon: "M3.5 16.5h13M5.5 13.5v-4M9 13.5v-7M12.5 13.5V9.5M16 13.5v-9",
  },
  { href: "/admin/time", label: "Time", icon: "M10 17a7 7 0 100-14 7 7 0 000 14zM10 6.5V10l2.5 1.8" },
  {
    href: "/admin/content",
    label: "Content",
    icon: "M4 4h12v12H4zM4 8h12M8 8v8",
  },
  {
    href: "/admin/security",
    label: "Security",
    icon: "M10 3l6 2.5v4.2c0 3.6-2.5 6.3-6 7.3-3.5-1-6-3.7-6-7.3V5.5z",
  },
  {
    href: "/admin/settings",
    label: "Settings",
    icon: "M4 6h7M14 6h2M11 4v4M4 14h2M9 14h7M6 12v4",
  },
];

const NO_COUNTS: NavCounts = { inbox: 0, tasks: 0, calendar: 0, billing: 0 };

export function AdminNav({ counts = NO_COUNTS }: { counts?: NavCounts }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin">
      <ul className="grid gap-0.5">
        {ITEMS.map((item) => {
          const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
          const count = item.count ? counts[item.count.key] : 0;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors",
                  active
                    ? "bg-white/[0.07] font-medium text-ink"
                    : "text-muted hover:bg-white/[0.04] hover:text-ink",
                )}
              >
                <svg
                  viewBox="0 0 20 20"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  aria-hidden
                >
                  <path d={item.icon} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {item.label}
                {count > 0 ? (
                  <span className="ml-auto rounded-full bg-accent px-1.5 font-mono text-[10px] leading-4 font-semibold text-accent-ink">
                    {count > 99 ? "99+" : count}
                    <span className="sr-only">{item.count?.label}</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
