import type { Metadata } from "next";
import Link from "next/link";
import { PostList } from "@/components/site/post-list";
import { PageIntro, Section } from "@/components/site/section";
import { postTags } from "@/lib/content/types";
import { pageContent } from "@/server/content/site";

export const metadata: Metadata = {
  title: "Blog",
  description: "Notes from real projects: security, architecture, AI and the decisions behind them.",
  alternates: { canonical: "/blog" },
};

export default async function BlogPage() {
  const content = await pageContent();
  const { posts } = content;
  const tags = postTags(content);
  return (
    <>
      <PageIntro
        label="Blog"
        title="Notes from the work."
        intro="Written after the work, not instead of it: how things were built and why."
      >
        <p className="rise mt-6 text-sm text-muted" style={{ "--delay": "220ms" } as React.CSSProperties}>
          <a href="/blog/rss.xml" className="underline-offset-4 hover:text-ink hover:underline">
            RSS feed
          </a>
        </p>
      </PageIntro>
      <Section id="posts" label={`${posts.length} ${posts.length === 1 ? "post" : "posts"}`}>
        <PostList posts={posts} />
        {tags.length ? (
          <ul className="mt-8 flex flex-wrap gap-2" aria-label="Tags">
            {tags.map(({ tag, count }) => (
              <li key={tag}>
                <Link
                  href={`/blog/tags/${tag}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-sm text-muted hover:border-line-strong hover:text-ink"
                >
                  #{tag} <span className="font-mono text-xs">{count}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>
    </>
  );
}
