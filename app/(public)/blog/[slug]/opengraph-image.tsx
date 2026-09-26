import { getPost, listPosts } from "@/server/content/posts";
import { ogImage, ogSize } from "@/server/content/og";

export const alt = "Blog post";
export const size = ogSize;
export const contentType = "image/png";

export async function generateStaticParams() {
  return (await listPosts()).map((post) => ({ slug: post.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const post = await getPost((await params).slug);
  return ogImage({ eyebrow: "Blog", title: post?.title ?? "Blog", subtitle: post?.description });
}
