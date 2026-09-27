import { z } from "zod";
import { notesText, requiredText, text } from "@/lib/forms";
import { isCalendarDate } from "@/lib/intake/time";

// What the public site shows, as the content editor writes it. One schema per kind, used by the editor in
// the browser and again on the server before anything is saved. Markdown bodies are stored as written and
// rendered on the server (see server/content/render.ts).

export const LIST_KINDS = ["work", "post", "service", "testimonial"] as const;
export const SINGLETON_KINDS = ["profile", "cv", "pricing"] as const;
export const CONTENT_KINDS = [...LIST_KINDS, ...SINGLETON_KINDS] as const;

export type ListKind = (typeof LIST_KINDS)[number];
export type SingletonKind = (typeof SINGLETON_KINDS)[number];
export type ContentKind = (typeof CONTENT_KINDS)[number];

export function isListKind(kind: ContentKind): kind is ListKind {
  return (LIST_KINDS as readonly string[]).includes(kind);
}

export const KIND_LABELS: Record<ContentKind, { one: string; many: string }> = {
  work: { one: "Case study", many: "Work" },
  post: { one: "Post", many: "Blog" },
  service: { one: "Service", many: "Services" },
  testimonial: { one: "Testimonial", many: "Testimonials" },
  profile: { one: "Profile", many: "Profile" },
  cv: { one: "CV", many: "CV" },
  pricing: { one: "Pricing terms", many: "Pricing terms" },
};

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const slugSchema = z
  .string()
  .trim()
  .min(1, "Add the name used in the address.")
  .max(80, "Must be 80 characters or fewer.")
  .regex(SLUG_PATTERN, "Use lower-case letters, digits and single hyphens.");

const line = (maxLength: number, message: string) => requiredText(maxLength, message);
const paragraph = (maxLength: number, message: string) => requiredText(maxLength, message, true);
const lines = (maxItems: number, maxLength: number) =>
  z.array(line(maxLength, "Fill in this line or remove it.")).max(maxItems, `At most ${maxItems}.`);
const optionalLine = (maxLength: number) => text({ maxLength }).transform((value) => value ?? "");

const faqItem = z
  .object({ q: line(200, "Add the question."), a: paragraph(1000, "Add the answer.") })
  .strict();

// --- Work (case studies and open-source projects) ------------------------------------------------------------

export const WORK_KINDS = ["Open source", "Private", "Landing page"] as const;
export const WORK_CATEGORIES = ["Web", "Discord bots", "Mobile", "Desktop", "Graphics"] as const;
export const REPO_PATTERN = /^https:\/\/github\.com\/leffloard\/[\w.-]+$/;

export const workSchema = z
  .object({
    slug: slugSchema,
    title: line(80, "Add a title."),
    tagline: line(160, "Add a one-line tagline."),
    summary: paragraph(600, "Add a short summary."),
    year: z
      .string()
      .trim()
      .regex(/^\d{4}(?:\s?[–-]\s?(?:\d{4}|present))?$/, "A year like 2026, or a span like 2024–2026."),
    kind: z.enum(WORK_KINDS),
    category: z.enum(WORK_CATEGORIES),
    stack: lines(20, 40),
    repo: z
      .string()
      .trim()
      .max(200)
      .refine(
        (value) => value === "" || REPO_PATTERN.test(value),
        "Only a repository of github.com/leffloard.",
      )
      .transform((value) => value || null),
    featured: z.boolean(),
    highlights: lines(4, 60),
    status: line(200, "Say where the project stands."),
    body: paragraph(40_000, "Write the case study."),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "Private" && value.repo) {
      context.addIssue({
        code: "custom",
        path: ["repo"],
        message: "A private project never links to its code.",
      });
    }
    if (value.featured && value.highlights.length < 2) {
      context.addIssue({
        code: "custom",
        path: ["highlights"],
        message: "A featured project needs two or three short highlights.",
      });
    }
  });

// --- Blog posts --------------------------------------------------------------------------------------------------

export const postSchema = z
  .object({
    slug: slugSchema,
    title: line(120, "Add a title."),
    description: paragraph(300, "Add a description: search engines and link previews show it."),
    date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "A date like 2026-09-26.")
      .refine((value) => isCalendarDate(value), "A date that exists, like 2026-09-26."),
    tags: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Tags use lower-case letters, digits and hyphens."),
      )
      .max(8, "At most 8 tags."),
    body: paragraph(60_000, "Write the post."),
  })
  .strict();

// --- Services and their packages -----------------------------------------------------------------------------

export const packageSchema = z
  .object({
    name: line(40, "Name the package."),
    price: z.number().int("Whole dollars.").min(0).max(1_000_000),
    per: z.enum(["month"]).nullable(),
    summary: line(200, "Add a one-line summary."),
    includes: lines(12, 160),
    revisions: z.number().int().min(0).max(20).nullable(),
    timeline: line(60, "Say how long it takes."),
    highlighted: z.boolean(),
  })
  .strict();

export const serviceSchema = z
  .object({
    slug: slugSchema,
    title: line(60, "Add a title."),
    short: line(200, "Add a one-line description."),
    intro: paragraph(600, "Add an introduction."),
    forWhom: paragraph(400, "Say who it is for."),
    packages: z.array(packageSchema).min(1, "Add at least one package.").max(6, "At most 6 packages."),
    addOns: z
      .array(z.object({ name: line(80, "Name the add-on."), price: line(40, "Add its price.") }).strict())
      .max(12, "At most 12 add-ons."),
    deliverables: lines(12, 160),
    proof: z.array(slugSchema).max(6, "At most 6 projects."),
    faq: z.array(faqItem).max(12, "At most 12 questions."),
  })
  .strict();

// --- Testimonials ------------------------------------------------------------------------------------------------

export const testimonialSchema = z
  .object({
    quote: paragraph(600, "Add the quote."),
    name: line(80, "Add the person's name."),
    role: optionalLine(120),
    workSlug: z
      .string()
      .trim()
      .max(80)
      .refine((value) => value === "" || SLUG_PATTERN.test(value), "Pick a project.")
      .transform((value) => value || null),
    // Published only with the person's permission; the note (where and when they agreed) stays private.
    consent: z.boolean(),
    consentNote: notesText(300),
  })
  .strict();

// --- Singletons: the profile, the CV and the pricing terms ---------------------------------------------------

export const profileSchema = z
  .object({
    availability: z
      .object({
        open: z.boolean(),
        openLabel: line(60, "Add the badge's text while you take projects."),
        closedLabel: line(60, "Add the badge's text while you are booked."),
      })
      .strict(),
    pitch: line(300, "Add the one-sentence pitch."),
    process: z
      .array(
        z.object({ title: line(40, "Name the step."), text: paragraph(300, "Describe the step.") }).strict(),
      )
      .min(1, "Add at least one step.")
      .max(6, "At most 6 steps."),
  })
  .strict();

export const cvSchema = z
  .object({
    headline: line(80, "Add the headline."),
    summary: paragraph(1200, "Add the summary."),
    experience: z
      .array(
        z
          .object({
            role: line(80, "Add the role."),
            place: line(80, "Add where."),
            period: line(40, "Add when."),
            points: lines(10, 300),
          })
          .strict(),
      )
      .max(10),
    education: z
      .array(
        z
          .object({
            place: line(80, "Add where."),
            detail: line(120, "Add what."),
            period: line(40, "Add when."),
          })
          .strict(),
      )
      .max(6),
    skills: z
      .array(
        z
          .object({
            group: line(40, "Name the group."),
            items: lines(12, 40),
            proof: z.array(slugSchema).max(6, "At most 6 projects."),
          })
          .strict(),
      )
      .max(12),
    languages: z
      .array(z.object({ name: line(40, "Add the language."), level: line(40, "Add the level.") }).strict())
      .max(8),
  })
  .strict();

export const pricingSchema = z
  .object({
    paymentTerms: z
      .array(
        z.object({ title: line(60, "Add the amount range."), text: line(300, "Add the terms.") }).strict(),
      )
      .max(6),
    terms: lines(12, 300),
    paymentMethods: z
      .array(z.object({ name: line(40, "Name the method."), note: line(120, "Add a note.") }).strict())
      .max(6),
    faq: z.array(faqItem).max(12, "At most 12 questions."),
  })
  .strict();

export const CONTENT_SCHEMAS = {
  work: workSchema,
  post: postSchema,
  service: serviceSchema,
  testimonial: testimonialSchema,
  profile: profileSchema,
  cv: cvSchema,
  pricing: pricingSchema,
} as const;

export type ContentInput = { [K in ContentKind]: z.input<(typeof CONTENT_SCHEMAS)[K]> };
export type ContentData = { [K in ContentKind]: z.output<(typeof CONTENT_SCHEMAS)[K]> };

export type WorkData = ContentData["work"];
export type PostData = ContentData["post"];
export type ServiceData = ContentData["service"];
export type PackageData = z.output<typeof packageSchema>;
export type TestimonialData = ContentData["testimonial"];
export type ProfileData = ContentData["profile"];
export type CvData = ContentData["cv"];
export type PricingData = ContentData["pricing"];
