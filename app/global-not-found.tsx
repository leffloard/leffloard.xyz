import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Page not found — Mert Kaan Koparan",
};

export default function GlobalNotFound() {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-6 px-6">
          <p className="text-muted font-mono text-xs tracking-[0.08em] uppercase">Error 404</p>
          <h1 className="text-5xl font-semibold tracking-tight">This page does not exist.</h1>
          <p className="text-muted text-lg">
            <Link className="text-accent underline-offset-4 hover:underline" href="/">
              Go to the home page
            </Link>
          </p>
        </main>
      </body>
    </html>
  );
}
