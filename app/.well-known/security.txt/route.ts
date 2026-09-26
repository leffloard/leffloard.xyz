import { site } from "@/content/site";

// RFC 9116. Regenerated on every build, so the expiry date moves forward with each release.
export const dynamic = "force-static";

export function GET(): Response {
  const expires = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  const body = [
    `Contact: mailto:${site.email}`,
    `Expires: ${expires}`,
    "Preferred-Languages: en, tr",
    `Canonical: ${site.origin}/.well-known/security.txt`,
    `Policy: ${site.origin}/colophon`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
