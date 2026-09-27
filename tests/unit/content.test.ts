import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cv } from "@/content/cv";
import { services } from "@/content/services";
import { site } from "@/content/site";
import { findWork, work } from "@/content/work";

// Checks on the site's own content, run on every change: broken references, and things that must never be
// published (phone numbers, links to private code, template leftovers).

function allText(): string {
  const dir = path.join(process.cwd(), "content");
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
  return files.map((file) => readFileSync(file, "utf8")).join("\n");
}

describe("site content", () => {
  it("has unique work slugs and valid references", () => {
    const slugs = work.map((item) => item.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of [
      ...services.flatMap((service) => service.proof),
      ...cv.skills.flatMap((skill) => skill.proof),
    ]) {
      expect(findWork(slug), `unknown work slug "${slug}"`).toBeDefined();
    }
  });

  it("never links to the code of a private project", () => {
    for (const item of work.filter((entry) => entry.kind === "Private")) expect(item.repo).toBeUndefined();
    for (const item of work.filter((entry) => entry.repo)) {
      expect(item.repo).toMatch(/^https:\/\/github\.com\/leffloard\/[\w.-]+$/);
    }
  });

  it("gives every featured project short, checkable highlights", () => {
    for (const item of work.filter((entry) => entry.featured)) {
      expect(item.highlights?.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("contains no phone numbers, template leftovers or secrets", () => {
    const text = allText();
    expect(text).not.toMatch(/\+90[\s(]*\d/); // the old template had a phone number
    expect(text).not.toMatch(/\(\d{3}\)\s?\d{3}[-\s]\d{4}/);
    expect(text).not.toMatch(/Sense Software|GoITeens|Berkeley|linkedin\.com/i);
    expect(text).not.toMatch(
      /discord(app)?\.com\/api\/webhooks|mongodb(\+srv)?:\/\/[^\s"']*@|sk-ant-|AKIA[0-9A-Z]{16}/,
    );
    expect(text).not.toMatch(/\b\d{17,20}\b/); // Discord snowflake ids
  });

  it("publishes only the contact details the owner chose", () => {
    expect(site.email).toBe("erzincanligotik@gmail.com");
    expect(site.location).toBe("Denizli, Turkey");
    expect(JSON.stringify(site)).not.toMatch(/phone|tel:/i);
  });
});
