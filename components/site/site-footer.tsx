import Link from "next/link";
import { Availability } from "@/components/site/availability";
import { LogoMark } from "@/components/site/logo";
import { navigation, site } from "@/content/site";

const LEGAL = [
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/legal/terms", label: "Terms" },
  { href: "/legal/refunds", label: "Refunds" },
  { href: "/colophon", label: "Colophon" },
];

export function SiteFooter() {
  return (
    <footer className="relative border-t border-line">
      <span aria-hidden className="crosshair top-0 left-0" />
      <span aria-hidden className="crosshair top-0 left-full" />
      <div className="grid gap-10 px-5 py-14 sm:px-10 md:grid-cols-12">
        <div className="md:col-span-5">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <LogoMark />
            <span className="text-[15px] font-semibold tracking-tight">leffloard</span>
          </Link>
          <p className="mt-4 max-w-sm text-sm text-muted">{site.pitch}</p>
          <Availability className="mt-5" />
        </div>
        <nav aria-label="Footer" className="md:col-span-3">
          <p className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">Site</p>
          <ul className="mt-4 grid gap-2 text-sm">
            {[
              ...navigation,
              { href: "/cv", label: "CV" },
              { href: "/contact", label: "Contact" },
              { href: "/book", label: "Book a call" },
              { href: "/portal", label: "Client portal" },
            ].map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-ink/80 hover:text-ink">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="md:col-span-4">
          <p className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">Contact</p>
          <ul className="mt-4 grid gap-2 text-sm">
            <li>
              <a href={`mailto:${site.email}`} className="text-ink/80 hover:text-ink">
                {site.email}
              </a>
            </li>
            <li>
              <a href={site.github} rel="noopener noreferrer" className="text-ink/80 hover:text-ink">
                github.com/{site.handle}
              </a>
            </li>
            <li className="text-muted">
              {site.location} · {site.timeZoneLabel}
            </li>
          </ul>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line px-5 py-6 text-xs text-muted sm:px-10">
        <p>
          © {new Date().getFullYear()} {site.name}
        </p>
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          {LEGAL.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="hover:text-ink">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}
