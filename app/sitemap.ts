import type { MetadataRoute } from "next";
import { site } from "@/content/site";
import { postTags } from "@/lib/content/types";
import { publishedContent } from "@/server/content/site";

// From the published content, on request (the content lives in the database).
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const content = await publishedContent();
  const { work, services, posts } = content;
  const tags = postTags(content);
  const page = (path: string, priority = 0.6, lastModified?: string) => ({
    url: `${site.origin}${path}`,
    priority,
    ...(lastModified ? { lastModified } : {}),
  });
  return [
    page("/", 1),
    page("/work", 0.9),
    ...work.map((item) => page(`/work/${item.slug}`, 0.8)),
    page("/services", 0.9),
    ...services.map((service) => page(`/services/${service.slug}`, 0.8)),
    page("/pricing", 0.9),
    page("/about", 0.7),
    page("/cv", 0.7),
    page("/contact", 0.8),
    page("/book", 0.8),
    page("/blog", 0.7),
    ...posts.map((post) => page(`/blog/${post.slug}`, 0.6, post.date)),
    ...tags.map(({ tag }) => page(`/blog/tags/${tag}`, 0.3)),
    page("/legal/privacy", 0.2),
    page("/legal/terms", 0.2),
    page("/legal/refunds", 0.2),
    page("/colophon", 0.3),
  ];
}
