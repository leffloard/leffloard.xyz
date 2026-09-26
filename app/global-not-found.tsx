import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { headers } from "next/headers";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Page not found — Mert Kaan Koparan",
};

// Rendered per request (reading the request's headers makes it so), so it carries the CSP nonce that the
// proxy gives an address under the site's page sections (/legal/…, /work/a/b).
export default async function GlobalNotFound() {
  await headers();
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-6 px-6">
          <p className="font-mono text-xs tracking-[0.08em] text-muted uppercase">Error 404</p>
          <h1 className="text-5xl font-semibold tracking-tight">This page does not exist.</h1>
          <p className="text-lg text-muted">
            <Link className="text-accent underline-offset-4 hover:underline" href="/">
              Go to the home page
            </Link>
          </p>
        </main>
      </body>
    </html>
  );
}
