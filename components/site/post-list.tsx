import Link from "next/link";
import { Arrow } from "@/components/site/link-button";
import { formatPostDate, type PostMeta } from "@/server/content/posts";

export function PostList({ posts }: { posts: PostMeta[] }) {
  return (
    <ul className="divide-y divide-line border-y border-line">
      {posts.map((post) => (
        <li key={post.slug}>
          <Link
            href={`/blog/${post.slug}`}
            className="group grid gap-2 py-6 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent md:grid-cols-12 md:gap-6"
          >
            <p className="font-mono text-xs text-muted md:col-span-3 md:pt-1">
              <time dateTime={post.date}>{formatPostDate(post.date)}</time> · {post.readingMinutes} min
            </p>
            <div className="md:col-span-8">
              <h3 className="text-xl font-semibold tracking-tight group-hover:text-accent">{post.title}</h3>
              <p className="mt-2 text-[15px] text-pretty text-muted">{post.description}</p>
            </div>
            <Arrow className="hidden size-4 text-muted group-hover:text-ink md:col-span-1 md:block md:justify-self-end" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
