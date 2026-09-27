import { site } from "@/content/site";
import { publishedContent } from "@/server/content/site";

export const dynamic = "force-dynamic";

function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function GET(): Promise<Response> {
  const { posts } = await publishedContent();
  const items = posts
    .map(
      (post) => `    <item>
      <title>${escape(post.title)}</title>
      <link>${site.origin}/blog/${post.slug}</link>
      <guid isPermaLink="true">${site.origin}/blog/${post.slug}</guid>
      <pubDate>${new Date(`${post.date}T09:00:00Z`).toUTCString()}</pubDate>
      <description>${escape(post.description)}</description>
${post.tags.map((tag) => `      <category>${escape(tag)}</category>`).join("\n")}
    </item>`,
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>leffloard.xyz blog</title>
    <link>${site.origin}/blog</link>
    <description>${escape(`Notes from the work of ${site.name}.`)}</description>
    <language>en</language>
    <atom:link href="${site.origin}/blog/rss.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8" } });
}
