import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "../globals.css";

export const metadata: Metadata = {
  title: {
    default: "Mert Kaan Koparan — Independent software developer",
    template: "%s — Mert Kaan Koparan",
  },
  description:
    "Websites, web apps, Discord bots, authentication systems and desktop software, built by an independent developer from Denizli, Turkey.",
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
