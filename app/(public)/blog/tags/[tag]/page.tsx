import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PostList } from "@/components/site/post-list";
import { PageIntro, Section } from "@/components/site/section";
import { pageContent } from "@/server/content/site";

export async function generateMetadata({ params }: { params: Promise<{ tag: string }> }): Promise<Metadata> {
  const { tag } = await params;
  return { title: `Posts tagged #${tag}`, alternates: { canonical: `/blog/tags/${tag}` } };
}

export default async function TagPage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = await params;
  const posts = (await pageContent()).posts.filter((post) => post.tags.includes(tag));
  if (posts.length === 0) notFound();
  return (
    <>
      <PageIntro label="Blog / Tag" title={`#${tag}`} />
      <Section id="posts" label={`${posts.length} ${posts.length === 1 ? "post" : "posts"}`}>
        <PostList posts={posts} />
      </Section>
    </>
  );
}
