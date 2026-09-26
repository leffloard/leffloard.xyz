import Link from "next/link";
import { LogoMark } from "@/components/site/logo";
import { LinkButton } from "@/components/site/link-button";
import { SiteNav } from "@/components/site/site-nav";
import { navigation } from "@/content/site";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5 sm:px-10">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          <LogoMark />
          <span className="text-[15px] font-semibold tracking-tight">leffloard</span>
        </Link>
        <SiteNav items={navigation} />
        <LinkButton href="/contact" size="sm" className="ml-auto hidden md:inline-flex">
          Start a project
        </LinkButton>
        <details className="group relative ml-auto md:hidden">
          <summary className="flex h-9 cursor-pointer list-none items-center rounded-full border border-line-strong px-4 text-[13px] [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Menu</span>
            <span className="hidden group-open:inline">Close</span>
          </summary>
          <nav
            aria-label="Main"
            className="absolute right-0 mt-3 w-64 rounded-2xl border border-line bg-surface p-2 shadow-2xl shadow-black/30"
          >
            <ul>
              {navigation.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="block rounded-lg px-3 py-2.5 text-sm hover:bg-ink/[0.05]">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
            <LinkButton href="/contact" size="sm" className="mt-2 w-full">
              Start a project
            </LinkButton>
          </nav>
        </details>
      </div>
    </header>
  );
}
