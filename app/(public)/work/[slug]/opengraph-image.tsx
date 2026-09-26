import { findWork, work } from "@/content/work";
import { ogImage, ogSize } from "@/server/content/og";

export const alt = "Case study";
export const size = ogSize;
export const contentType = "image/png";

export function generateStaticParams() {
  return work.map((item) => ({ slug: item.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const item = findWork((await params).slug);
  return ogImage({ eyebrow: "Case study", title: item?.title ?? "Work", subtitle: item?.tagline });
}
