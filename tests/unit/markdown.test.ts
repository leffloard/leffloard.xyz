import { beforeAll, describe, expect, it } from "vitest";
import { work as seedWork } from "@/content/work";
import { CONTENT_SCHEMAS, type ContentKind } from "@/lib/content/schemas";
import { renderMarkdown, renderSections, renderStored, slugify } from "@/server/content/render";
import { seedInputs } from "@/server/content/seed";

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

describe("images", () => {
  it("keeps only images from the media library, loaded lazily", async () => {
    const hash = "a".repeat(64);
    const { html } = await renderMarkdown(
      [
        `![Diagram](/media/${hash}.webp)`,
        "![Tracker](https://evil.example/pixel.png)",
        "![Local](/other.png)",
      ].join("\n\n"),
    );
    expect(html).toContain(`<img src="/media/${hash}.webp" alt="Diagram" loading="lazy" decoding="async">`);
    expect(html).not.toMatch(/evil\.example|other\.png/);
  });
});

describe("case studies", () => {
  it("cut into a lead and numbered sections at their h2 headings", async () => {
    expect(await renderSections("Intro text.\n\n## Problem\n\nIt broke.\n\n## Fix\n\n- One\n- Two")).toEqual({
      lead: "<p>Intro text.</p>",
      sections: [
        { heading: "Problem", id: "problem", html: "<p>It broke.</p>" },
        { heading: "Fix", id: "fix", html: "<ul>\n<li>One</li>\n<li>Two</li>\n</ul>" },
      ],
      headings: [
        { id: "problem", text: "Problem" },
        { id: "fix", text: "Fix" },
      ],
    });
  });

  it("are cut in the tree, so markup inside an attribute stays inert", async () => {
    const attack =
      '[x](https://a.example "<h2 ><meta http-equiv=refresh content=0;url=https://evil.example><img src=x onerror=alert(1)>")\n\n![Screenshot of the <h2> styles](/media/' +
      "b".repeat(64) +
      ".webp)\n\n## Real heading\n\nText.";
    const { lead, sections } = await renderSections(attack);
    expect(sections.map((section) => section.heading)).toEqual(["Real heading"]);
    expect(sections[0]!.html).toBe("<p>Text.</p>");
    // The title and alt keep their text as attribute values of their own elements, closed properly.
    expect(lead).toMatch(
      /^<p><a href="https:\/\/a\.example" title="[^"]*" rel="noopener noreferrer">x<\/a><\/p>/,
    );
    // Outside quoted attribute values (where "<" is only text), no other element or handler appears.
    const markup = lead.replace(/"[^"]*"/g, '""');
    expect(markup).not.toMatch(/<meta|onerror/);
    expect(markup.match(/<[a-z]+/g)).toEqual(["<p", "<a", "<p", "<img"]);
    expect(lead).toContain('alt="Screenshot of the <h2> styles"');
  });
});

// The text a visitor reads, without tags or entities.
function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

describe("a post's date", () => {
  it("must exist in the calendar", () => {
    const base = { slug: "a", title: "A title", description: "Some words.", tags: [], body: "Text." };
    expect(CONTENT_SCHEMAS.post.safeParse({ ...base, date: "2026-09-26" }).success).toBe(true);
    for (const date of ["2026-13-01", "2026-02-30", "2026-9-26"]) {
      expect(CONTENT_SCHEMAS.post.safeParse({ ...base, date }).success, date).toBe(false);
    }
  });
});

describe("the seed content", () => {
  it("passes the editor's rules and renders", async () => {
    const inputs = await seedInputs();
    for (const kind of Object.keys(inputs) as ContentKind[]) {
      for (const input of inputs[kind]) {
        const parsed = CONTENT_SCHEMAS[kind].safeParse(input);
        expect(parsed.success, `${kind}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      }
    }
    expect(inputs.post.length).toBeGreaterThanOrEqual(2);
    for (const post of inputs.post) expect(post.tags.length).toBeGreaterThan(0);
    expect(inputs.profile).toHaveLength(1);
  });

  it("keeps every word of the old case studies after the move to Markdown", async () => {
    const inputs = await seedInputs();
    for (const [index, item] of seedWork.entries()) {
      const data = CONTENT_SCHEMAS.work.parse(inputs.work[index]);
      const stored = await renderStored("work", data);
      const shown = stored.sections
        .map((section) => `${section.heading} ${visibleText(section.html)}`)
        .join(" ");
      const original = item.sections
        .map((section) => [section.heading, ...section.paragraphs, ...(section.points ?? [])].join(" "))
        .join(" ")
        .replace(/\s+/g, " ");
      expect(shown, item.slug).toBe(original);
      expect(stored.lead).toBe("");
    }
  });
});
