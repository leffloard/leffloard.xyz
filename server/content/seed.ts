import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { MongoServerError, ObjectId, type Db } from "mongodb";
import { cv } from "@/content/cv";
import { paymentMethods, paymentTerms, pricingFaq, services, termsList } from "@/content/services";
import { process as steps, site } from "@/content/site";
import { work, type WorkItem as SeedWork } from "@/content/work";
import { ranksFor } from "@/lib/rank";
import { CONTENT_SCHEMAS, type ContentInput, type ContentKind } from "@/lib/content/schemas";
import { now } from "@/server/clock";
import { contentItems, contentState } from "@/server/content/collections";
import { renderStored } from "@/server/content/render";
import type { ContentDoc } from "@/server/content/types";
import { inTransaction } from "@/server/db/transaction";

// The site's first content, copied once into an empty database from the files in content/ (which were the
// site's content until the editor arrived in M9, and remain the starting point of a new database). After
// that the database is the only source: editing content/ changes nothing on a running site.

const BLOG_DIR = path.join(process.cwd(), "content", "blog");
const DUPLICATE_KEY = 11000;

// Characters Markdown would read as formatting, escaped so the old plain text renders exactly as before.
function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]<>])/g, "\\$1").replace(/^([#>+-]|\d+[.)])/, "\\$1");
}

export function sectionsToMarkdown(sections: SeedWork["sections"]): string {
  return sections
    .map((section) =>
      [
        `## ${escapeMarkdown(section.heading)}`,
        ...section.paragraphs.map(escapeMarkdown),
        ...(section.points?.length
          ? [section.points.map((point) => `- ${escapeMarkdown(point)}`).join("\n")]
          : []),
      ].join("\n\n"),
    )
    .join("\n\n");
}

export function parseFrontmatter(source: string): { data: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { data: {}, body: source };
  const data: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator > 0) data[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return { data, body: source.slice(match[0].length) };
}

function workInput(item: SeedWork): ContentInput["work"] {
  return {
    slug: item.slug,
    title: item.title,
    tagline: item.tagline,
    summary: item.summary,
    year: item.year,
    kind: item.kind,
    category: item.category,
    stack: [...item.stack],
    repo: item.repo ?? "",
    featured: item.featured,
    highlights: [...(item.highlights ?? [])],
    status: item.status,
    body: sectionsToMarkdown(item.sections),
  };
}

async function postInputs(): Promise<ContentInput["post"][]> {
  const files = (await readdir(BLOG_DIR)).filter((name) => name.endsWith(".md")).sort();
  return Promise.all(
    files.map(async (name) => {
      const { data, body } = parseFrontmatter(await readFile(path.join(BLOG_DIR, name), "utf8"));
      return {
        slug: name.replace(/\.md$/, ""),
        title: data.title ?? "",
        description: data.description ?? "",
        date: data.date ?? "",
        tags: (data.tags ?? "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        body,
      };
    }),
  );
}

// Everything the seed writes, as editor input (checked by the same schemas as the editor's).
export async function seedInputs(): Promise<{ [K in ContentKind]: ContentInput[K][] }> {
  return {
    profile: [
      {
        availability: {
          open: site.availability.open,
          openLabel: site.availability.label,
          closedLabel: "Fully booked at the moment",
        },
        pitch: site.pitch,
        process: steps.map((step) => ({ title: step.title, text: step.text })),
      },
    ],
    cv: [
      {
        headline: cv.headline,
        summary: cv.summary,
        experience: cv.experience.map((job) => ({ ...job, points: [...job.points] })),
        education: cv.education.map((entry) => ({ ...entry })),
        skills: cv.skills.map((skill) => ({
          group: skill.group,
          items: [...skill.items],
          proof: [...skill.proof],
        })),
        languages: cv.languages.map((language) => ({ ...language })),
      },
    ],
    pricing: [
      {
        paymentTerms: paymentTerms.map((term) => ({ ...term })),
        terms: [...termsList],
        paymentMethods: paymentMethods.map((method) => ({ ...method })),
        faq: pricingFaq.map((item) => ({ ...item })),
      },
    ],
    work: work.map(workInput),
    post: await postInputs(),
    service: services.map((service) => ({
      ...service,
      packages: service.packages.map((pack) => ({
        ...pack,
        per: pack.per ?? null,
        includes: [...pack.includes],
        highlighted: pack.highlighted ?? false,
      })),
      addOns: service.addOns.map((addOn) => ({ ...addOn })),
      deliverables: [...service.deliverables],
      proof: [...service.proof],
      faq: service.faq.map((item) => ({ ...item })),
    })),
    testimonial: [],
  };
}

async function seedDocuments(at: Date): Promise<ContentDoc[]> {
  const inputs = await seedInputs();
  const docs: ContentDoc[] = [];
  for (const kind of Object.keys(inputs) as ContentKind[]) {
    const items = inputs[kind];
    const ranks = ranksFor(items.length);
    for (const [index, input] of items.entries()) {
      const data = CONTENT_SCHEMAS[kind].parse(input);
      const stored = await renderStored(kind, data as never);
      const key = "slug" in data ? data.slug : kind;
      docs.push({
        _id: new ObjectId(),
        kind,
        key,
        draft: stored,
        published: stored,
        publishedAt: at,
        publishAt: null,
        changed: false,
        rank: ranks[index]!,
        version: 1,
        createdAt: at,
        updatedAt: at,
      } as ContentDoc);
    }
  }
  return docs;
}

// Fills an empty database once. Safe to call from several processes at the same moment: one writes, the
// others find the content there.
export async function seedContent(db: Db, at: Date = now()): Promise<boolean> {
  if (await contentState(db).findOne({ _id: "site" }, { projection: { _id: 1 } })) return false;
  const docs = await seedDocuments(at);
  try {
    return await inTransaction(db, async (session) => {
      if (await contentState(db).findOne({ _id: "site" }, { session, projection: { _id: 1 } })) return false;
      await contentState(db).insertOne(
        { _id: "site", generation: 1, seededAt: at, updatedAt: at },
        { session },
      );
      await contentItems(db).insertMany(docs, { session });
      return true;
    });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === DUPLICATE_KEY) return false;
    throw error;
  }
}
