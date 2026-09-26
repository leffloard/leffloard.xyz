import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { site } from "@/content/site";
import "../globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.origin),
  title: {
    default: `${site.name}: independent software developer`,
    template: `%s · ${site.name}`,
  },
  description: site.pitch,
  applicationName: "leffloard.xyz",
  authors: [{ name: site.name, url: site.origin }],
  creator: site.name,
  openGraph: {
    type: "website",
    siteName: "leffloard.xyz",
    locale: "en_US",
    url: "/",
  },
  twitter: { card: "summary_large_image" },
  alternates: {
    canonical: "/",
    types: { "application/rss+xml": [{ url: "/blog/rss.xml", title: "leffloard.xyz blog" }] },
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#090a0c" },
    { media: "(prefers-color-scheme: light)", color: "#f9fafb" },
  ],
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`site-theme ${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="bg-canvas text-ink antialiased">
        <a
          href="#content"
          className="sr-only z-50 rounded-full bg-ink px-4 py-2 text-sm text-canvas focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <div aria-hidden className="drawing-frame">
          <div />
        </div>
        <div className="relative z-10 overflow-x-clip">
          <SiteHeader />
          <main id="content" className="mx-auto max-w-6xl">
            {children}
          </main>
          <div className="mx-auto max-w-6xl">
            <SiteFooter />
          </div>
        </div>
      </body>
    </html>
  );
}
