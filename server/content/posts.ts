import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import rehypeShiki from "@shikijs/rehype";
import type { Element, Root } from "hast";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { cache } from "react";
import { unified } from "unified";

// Blog posts are Markdown files in content/blog, rendered at build time: Markdown → HTML → sanitized →
// highlighted. The sanitizer runs before highlighting, so only Shiki's own output adds styling.

const BLOG_DIR = path.join(process.cwd(), "content", "blog");
const WORDS_PER_MINUTE = 220;

export type PostMeta = {
  slug: string;
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
  tags: string[];
  readingMinutes: number;
};

export type Post = PostMeta & { html: string; headings: { id: string; text: string }[] };

function parseFrontmatter(source: string): { data: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { data: {}, body: source };
  const data: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator > 0) data[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return { data, body: source.slice(match[0].length) };
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function textOf(node: Element | Root): string {
  return node.children
    .map((child) => (child.type === "text" ? child.value : child.type === "element" ? textOf(child) : ""))
    .join("");
}

// Gives h2/h3 headings stable ids (for the table of contents) and external links rel attributes.
function rehypeDecorate(headings: Post["headings"]) {
  return () => (tree: Root) => {
    const visit = (node: Root | Element) => {
      for (const child of node.children) {
        if (child.type !== "element") continue;
        if (child.tagName === "h2" || child.tagName === "h3") {
          const text = textOf(child);
          const id = slugify(text);
          child.properties.id = id;
          if (child.tagName === "h2") headings.push({ id, text });
        }
        if (
          child.tagName === "a" &&
          typeof child.properties.href === "string" &&
          /^https?:/.test(child.properties.href)
        ) {
          child.properties.rel = ["noopener", "noreferrer"];
        }
        visit(child);
      }
    };
    visit(tree);
  };
}

export async function renderMarkdown(
  markdown: string,
): Promise<{ html: string; headings: Post["headings"] }> {
  const headings: Post["headings"] = [];
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSanitize, {
      ...defaultSchema,
      attributes: { ...defaultSchema.attributes, code: [["className", /^language-[a-z0-9-]+$/]] },
    })
    .use(rehypeDecorate(headings))
    .use(rehypeShiki, {
      themes: { light: "github-light", dark: "github-dark-dimmed" },
      defaultColor: false,
      fallbackLanguage: "text",
    })
    .use(rehypeStringify)
    .process(markdown);
  return { html: String(file), headings };
}

function meta(slug: string, data: Record<string, string>, body: string): PostMeta {
  const words = body.split(/\s+/).filter(Boolean).length;
  if (!data.title || !data.date || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    throw new Error(`content/blog/${slug}.md needs a title and a date (YYYY-MM-DD).`);
  }
  return {
    slug,
    title: data.title,
    description: data.description ?? "",
    date: data.date,
    tags: (data.tags ?? "")
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean),
    readingMinutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
  };
}

export const listPosts = cache(async (): Promise<PostMeta[]> => {
  const files = (await readdir(BLOG_DIR)).filter((name) => name.endsWith(".md"));
  const posts = await Promise.all(
    files.map(async (name) => {
      const slug = name.replace(/\.md$/, "");
      const { data, body } = parseFrontmatter(await readFile(path.join(BLOG_DIR, name), "utf8"));
      return meta(slug, data, body);
    }),
  );
  return posts.sort((a, b) => b.date.localeCompare(a.date));
});

export const getPost = cache(async (slug: string): Promise<Post | null> => {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  let source: string;
  try {
    source = await readFile(path.join(BLOG_DIR, `${slug}.md`), "utf8");
  } catch {
    return null;
  }
  const { data, body } = parseFrontmatter(source);
  const { html, headings } = await renderMarkdown(body);
  return { ...meta(slug, data, body), html, headings };
});

export async function listTags(): Promise<{ tag: string; count: number }[]> {
  const counts = new Map<string, number>();
  for (const post of await listPosts()) {
    for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function formatPostDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}
