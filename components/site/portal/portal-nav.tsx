"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";

const ITEMS = [
  { href: "/portal", label: "Overview" },
  { href: "/portal/billing", label: "Invoices" },
  { href: "/portal/meetings", label: "Calls" },
  { href: "/portal/account", label: "Account" },
];

// The portal's own menu, under the site's header, for a signed-in client.
export function PortalNav({ name }: { name: string }) {
  const pathname = usePathname();
  return (
    <div className="border-b border-line px-5 sm:px-10">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
        <p className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">
          Client portal · <span className="text-ink normal-case">{name}</span>
        </p>
        <nav aria-label="Client portal" className="flex flex-wrap gap-1 sm:ml-auto">
          {ITEMS.map((item) => {
            const active =
              item.href === "/portal"
                ? pathname === "/portal" || pathname.startsWith("/portal/projects")
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm transition-colors",
                  active ? "bg-ink/[0.08] text-ink" : "text-muted hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
