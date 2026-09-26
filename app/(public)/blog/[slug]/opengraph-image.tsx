import { findPost } from "@/lib/content/types";
import { ogImage, ogSize } from "@/server/content/og";
import { publishedContent } from "@/server/content/site";

export const alt = "Blog post";
export const size = ogSize;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// Only published content: link previews never show a draft.
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const post = findPost(await publishedContent(), (await params).slug);
  return ogImage({ eyebrow: "Blog", title: post?.title ?? "Blog", subtitle: post?.description });
}
