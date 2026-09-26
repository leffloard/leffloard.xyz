"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";

const ITEMS = [
  { href: "/admin", label: "Today", icon: "M4 6h12M4 10h12M4 14h7" },
  {
    href: "/admin/inbox",
    label: "Inbox",
    icon: "M3 11l2.2-5.7A1.5 1.5 0 016.6 4.3h6.8a1.5 1.5 0 011.4 1L17 11v4.2a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 15.2zM3 11h4l1 2h4l1-2h4",
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

export function AdminNav({ newInquiries = 0 }: { newInquiries?: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin">
      <ul className="grid gap-0.5">
        {ITEMS.map((item) => {
          const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
          const count = item.href === "/admin/inbox" ? newInquiries : 0;
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
                    <span className="sr-only"> new</span>
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
