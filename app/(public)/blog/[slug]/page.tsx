import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CtaBand } from "@/components/site/cta-band";
import { Arrow } from "@/components/site/link-button";
import { site } from "@/content/site";
import { formatPostDate, getPost, listPosts } from "@/server/content/posts";

export const dynamicParams = false;

export async function generateStaticParams() {
  return (await listPosts()).map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const post = await getPost((await params).slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url: `/blog/${post.slug}`,
      publishedTime: post.date,
      authors: [site.name],
      tags: post.tags,
    },
  };
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const post = await getPost((await params).slug);
  if (!post) notFound();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    author: { "@type": "Person", name: site.name, url: site.origin },
    url: `${site.origin}/blog/${post.slug}`,
  };

  return (
    <article>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <header className="px-5 pt-16 pb-12 sm:px-10 sm:pt-24">
        <Link
          href="/blog"
          className="rise inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] text-muted uppercase hover:text-ink"
        >
          <Arrow className="rotate-180" /> Blog
        </Link>
        <h1
          className="rise mt-6 max-w-4xl text-4xl leading-[1.05] font-semibold tracking-[-0.03em] text-balance sm:text-5xl"
          style={{ "--delay": "80ms" } as React.CSSProperties}
        >
          {post.title}
        </h1>
        <p
          className="rise mt-5 max-w-2xl text-lg text-pretty text-muted"
          style={{ "--delay": "140ms" } as React.CSSProperties}
        >
          {post.description}
        </p>
        <p
          className="rise mt-6 font-mono text-xs text-muted"
          style={{ "--delay": "200ms" } as React.CSSProperties}
        >
          <time dateTime={post.date}>{formatPostDate(post.date)}</time> · {post.readingMinutes} min read ·{" "}
          {post.tags.map((tag, index) => (
            <span key={tag}>
              {index > 0 ? ", " : ""}
              <Link href={`/blog/tags/${tag}`} className="hover:text-ink">
                #{tag}
              </Link>
            </span>
          ))}
        </p>
      </header>
      <div className="relative grid gap-10 border-t border-line px-5 py-12 sm:px-10 lg:grid-cols-12">
        <span aria-hidden className="crosshair top-0 left-0" />
        <span aria-hidden className="crosshair top-0 left-full" />
        {post.headings.length > 2 ? (
          <nav aria-label="On this page" className="hidden lg:col-span-3 lg:block">
            <div className="sticky top-24">
              <p className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">On this page</p>
              <ul className="mt-4 grid gap-2 text-sm">
                {post.headings.map((heading) => (
                  <li key={heading.id}>
                    <a href={`#${heading.id}`} className="text-muted hover:text-ink">
                      {heading.text}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        ) : null}
        <div
          className="prose max-w-[68ch] lg:col-span-8 lg:col-start-5"
          dangerouslySetInnerHTML={{ __html: post.html }}
        />
      </div>
      <CtaBand />
    </article>
  );
}
