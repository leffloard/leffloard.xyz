import { findWork } from "@/lib/content/types";
import { ogImage, ogSize } from "@/server/content/og";
import { publishedContent } from "@/server/content/site";

export const alt = "Case study";
export const size = ogSize;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// Only published content: link previews never show a draft.
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const item = findWork(await publishedContent(), (await params).slug);
  return ogImage({ eyebrow: "Case study", title: item?.title ?? "Work", subtitle: item?.tagline });
}
