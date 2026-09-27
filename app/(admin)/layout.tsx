import type { Metadata, Viewport } from "next";
import { GeistMono, GeistSans } from "@/components/fonts";
import "../globals.css";

// Everything under /admin is rendered per request (sessions, CSP nonces) and kept out of search engines.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin · leffloard.xyz" },
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = { colorScheme: "dark", themeColor: "#090a0c" };

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
