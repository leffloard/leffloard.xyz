import { beforeAll, describe, expect, it } from "vitest";
import { getPost, listPosts, listTags, renderMarkdown, slugify } from "@/server/content/posts";

// Shiki loads its themes and grammars on first use, which takes a few seconds once.
beforeAll(async () => {
  await renderMarkdown("```ts\nconst warm = 1;\n```");
}, 60_000);

describe("renderMarkdown", () => {
  it("strips scripts, event handlers and javascript: links", async () => {
    const { html } = await renderMarkdown(
      [
        "<script>alert(1)</script>",
        '<img src="x" onerror="alert(2)">',
        "[click](javascript:alert(3))",
        '<a href="https://example.com" onclick="alert(4)">ok</a>',
        '<iframe src="https://evil.example"></iframe>',
      ].join("\n\n"),
    );
    expect(html).not.toMatch(/<script|onerror|onclick|javascript:|<iframe/i);
  });

  it("gives headings ids and collects the table of contents", async () => {
    const { html, headings } = await renderMarkdown(
      "## First part\n\ntext\n\n### Detail\n\n## Second, part!",
    );
    expect(headings).toEqual([
      { id: "first-part", text: "First part" },
      { id: "second-part", text: "Second, part!" },
    ]);
    expect(html).toContain('<h2 id="first-part">');
    expect(html).toContain('<h3 id="detail">');
  });

  it("highlights code with both themes and marks external links", async () => {
    const { html } = await renderMarkdown("```ts\nconst a = 1;\n```\n\n[site](https://example.com)");
    expect(html).toContain('class="shiki');
    expect(html).toContain("--shiki-dark");
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe("slugify", () => {
  it("makes URL-safe slugs", () => {
    expect(slugify("Passkeys, and a lockout that cannot lock me out")).toBe(
      "passkeys-and-a-lockout-that-cannot-lock-me-out",
    );
    expect(slugify("  Çok güzel: ŞİMDİ  ")).toBe("cok-guzel-simdi");
  });
});

describe("the blog", () => {
  it("lists posts newest first with valid metadata", async () => {
    const posts = await listPosts();
    expect(posts.length).toBeGreaterThanOrEqual(2);
    expect([...posts].sort((a, b) => b.date.localeCompare(a.date))).toEqual(posts);
    for (const post of posts) {
      expect(post.title.length).toBeGreaterThan(5);
      expect(post.description.length).toBeGreaterThan(20);
      expect(post.tags.length).toBeGreaterThan(0);
    }
    expect((await listTags()).map((entry) => entry.tag)).toContain("security");
  });

  it("refuses slugs that could escape the blog folder", async () => {
    await expect(getPost("../../package")).resolves.toBeNull();
    await expect(getPost("not-a-post")).resolves.toBeNull();
  });
});
