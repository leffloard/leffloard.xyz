import type { Metadata } from "next";
import { LegalPage } from "@/components/site/legal";

export const metadata: Metadata = {
  title: "Colophon",
  description: "How this site is built: stack, security, performance and hosting.",
  alternates: { canonical: "/colophon" },
};

export default function ColophonPage() {
  return (
    <LegalPage title="How this site is built" updated="26 September 2026">
      <p>
        leffloard.xyz is one Next.js application: these public pages, and behind them an admin that runs my
        client work. The code is <a href="https://github.com/leffloard/leffloard.xyz">open source</a>.
      </p>
      <h2>Stack</h2>
      <ul>
        <li>Next.js 16 with the App Router, React 19 and strict TypeScript.</li>
        <li>Tailwind CSS 4, and Geist Sans and Geist Mono, served from this site.</li>
        <li>MongoDB through the official driver, with forward-only migrations.</li>
        <li>Blog posts in Markdown, sanitised and highlighted with Shiki at build time.</li>
        <li>
          The moving contour lines on the home page: a small WebGL2 shader that stays off with reduced motion.
        </li>
      </ul>
      <h2>Security</h2>
      <ul>
        <li>
          Admin sign-in with passkeys or a password plus an authenticator code, with progressive lockouts.
        </li>
        <li>A Content Security Policy on every page, with a new nonce for scripts on each request.</li>
        <li>No third-party scripts on public pages, apart from Cloudflare&apos;s bot check on forms.</li>
      </ul>
      <h2>Performance and accessibility</h2>
      <ul>
        <li>Public pages are generated ahead of time and served as static HTML.</li>
        <li>Colours meet WCAG AA contrast in both the light and the dark theme.</li>
        <li>
          Motion is limited to opacity and position, and disappears when your system asks for reduced motion.
        </li>
      </ul>
      <h2>Testing</h2>
      <p>
        Unit and integration tests run against a real MongoDB replica set, and browser tests check every page
        for console errors and Content Security Policy violations.
      </p>
    </LegalPage>
  );
}
