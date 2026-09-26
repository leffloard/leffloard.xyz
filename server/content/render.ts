import "server-only";
import rehypeShiki from "@shikijs/rehype";
import type { Element, ElementContent, Root } from "hast";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import type { ContentData, ContentKind } from "@/lib/content/schemas";
import type { Heading, Stored, WorkSection } from "@/lib/content/types";

// Markdown → HTML for posts and case studies, run when content is saved, never while a visitor waits:
// Markdown → HTML → sanitized → decorated → highlighted. The sanitizer runs before highlighting, so only
// Shiki's own output adds styling. The stored HTML is what the site shows.

const WORDS_PER_MINUTE = 220;

// Images come only from the media library (M9): anything else is dropped.
export const MEDIA_SRC = /^\/media\/[a-f0-9]{64}\.webp$/;

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

// Gives h2/h3 headings stable ids (for the table of contents), external links rel attributes, and images
// lazy loading; drops images that are not from the media library.
function rehypeDecorate(headings: Heading[]) {
  return () => (tree: Root) => {
    const used = new Map<string, number>();
    const visit = (node: Root | Element) => {
      node.children = node.children.filter(
        (child): child is ElementContent =>
          !(
            child.type === "element" &&
            child.tagName === "img" &&
            !(typeof child.properties.src === "string" && MEDIA_SRC.test(child.properties.src))
          ),
      ) as typeof node.children;
      for (const child of node.children) {
        if (child.type !== "element") continue;
        if (child.tagName === "h2" || child.tagName === "h3") {
          const text = textOf(child);
          const base = slugify(text) || "section";
          const seen = used.get(base) ?? 0;
          used.set(base, seen + 1);
          const id = seen ? `${base}-${seen + 1}` : base;
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
        if (child.tagName === "img") {
          child.properties.loading = "lazy";
          child.properties.decoding = "async";
        }
        visit(child);
      }
    };
    visit(tree);
  };
}

function processor(headings: Heading[]) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSanitize, {
      ...defaultSchema,
      attributes: {
        ...defaultSchema.attributes,
        code: [["className", /^language-[a-z0-9-]+$/]],
        img: ["src", "alt", "title"],
      },
    })
    .use(rehypeDecorate(headings))
    .use(rehypeShiki, {
      themes: { light: "github-light", dark: "github-dark-dimmed" },
      defaultColor: false,
      fallbackLanguage: "text",
    })
    .use(rehypeStringify);
}

// The sanitized, highlighted tree, and the serializer that turns (parts of) it into HTML.
async function renderTree(markdown: string) {
  const headings: Heading[] = [];
  const pipeline = processor(headings);
  const tree = (await pipeline.run(pipeline.parse(markdown))) as Root;
  const toHtml = (children: Root["children"]) =>
    pipeline.stringify({ type: "root", children } as Root).trim();
  return { tree, headings, toHtml };
}

export async function renderMarkdown(markdown: string): Promise<{ html: string; headings: Heading[] }> {
  const { tree, headings, toHtml } = await renderTree(markdown);
  return { html: toHtml(tree.children), headings };
}

// A case study cut at its top-level h2 headings, in the tree (never in the HTML text, where an attribute may
// contain "<h2"): what comes before the first one is the lead, and each heading starts a numbered section
// (the page draws the headings itself).
export async function renderSections(
  markdown: string,
): Promise<{ lead: string; sections: WorkSection[]; headings: Heading[] }> {
  const { tree, headings, toHtml } = await renderTree(markdown);
  const lead: Root["children"] = [];
  const parts: { heading: Element; children: Root["children"] }[] = [];
  for (const child of tree.children) {
    if (child.type === "element" && child.tagName === "h2") parts.push({ heading: child, children: [] });
    else (parts.at(-1)?.children ?? lead).push(child);
  }
  return {
    lead: toHtml(lead),
    sections: parts.map((part, index) => ({
      heading: textOf(part.heading),
      id:
        typeof part.heading.properties.id === "string" ? part.heading.properties.id : `section-${index + 1}`,
      html: toHtml(part.children),
    })),
    headings,
  };
}

export function readingMinutes(markdown: string): number {
  return Math.max(1, Math.round(markdown.split(/\s+/).filter(Boolean).length / WORDS_PER_MINUTE));
}

// What is stored for a kind: the data as written, plus what is rendered from it.
export async function renderStored<K extends ContentKind>(kind: K, data: ContentData[K]): Promise<Stored[K]> {
  if (kind === "work") {
    const work = data as ContentData["work"];
    const { lead, sections } = await renderSections(work.body);
    return { ...work, lead, sections } as Stored[K];
  }
  if (kind === "post") {
    const post = data as ContentData["post"];
    const { html, headings } = await renderMarkdown(post.body);
    return { ...post, html, headings, readingMinutes: readingMinutes(post.body) } as Stored[K];
  }
  return data as Stored[K];
}
