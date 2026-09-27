import type { ContentInput, ContentKind } from "@/lib/content/schemas";
import { WORK_CATEGORIES, WORK_KINDS } from "@/lib/content/schemas";

// The content editor's forms, as data: one list of fields per kind, rendered by
// components/admin/content/content-form.tsx and checked by the schemas in lib/content/schemas.ts.

type Base = { name: string; label: string; hint?: string };

export type FieldSpec =
  | (Base & { type: "text"; placeholder?: string })
  | (Base & { type: "textarea"; rows?: number })
  | (Base & { type: "markdown" })
  | (Base & { type: "number"; nullable?: boolean })
  | (Base & { type: "boolean" })
  | (Base & { type: "date" })
  | (Base & { type: "select"; options: { value: string; label: string }[]; nullable?: boolean })
  | (Base & { type: "lines"; rows?: number }) // a list of short texts, one per line
  | (Base & { type: "workRefs" }) // work items to link, by slug
  | (Base & { type: "workRef" }) // one work item, or none
  | (Base & { type: "group"; fields: FieldSpec[] })
  | (Base & { type: "list"; item: FieldSpec[]; itemLabel: string; empty: Record<string, unknown> });

const slug = (path: string): FieldSpec => ({
  name: "slug",
  label: "Address name",
  type: "text",
  hint: `The page is at ${path}<name>: lower-case letters, digits and hyphens.`,
});

const faq: FieldSpec = {
  name: "faq",
  label: "Questions",
  type: "list",
  itemLabel: "Question",
  item: [
    { name: "q", label: "Question", type: "text" },
    { name: "a", label: "Answer", type: "textarea", rows: 3 },
  ],
  empty: { q: "", a: "" },
};

const emptyPackage = {
  name: "",
  price: 0,
  per: null,
  summary: "",
  includes: [],
  revisions: 2,
  timeline: "",
  highlighted: false,
};

export const CONTENT_FIELDS: Record<ContentKind, FieldSpec[]> = {
  work: [
    { name: "title", label: "Title", type: "text" },
    slug("/work/"),
    { name: "tagline", label: "Tagline", type: "text", hint: "One line under the title." },
    {
      name: "summary",
      label: "Summary",
      type: "textarea",
      rows: 3,
      hint: "Shown on the card and in search results.",
    },
    { name: "year", label: "Year", type: "text", placeholder: "2026" },
    {
      name: "kind",
      label: "Type",
      type: "select",
      options: WORK_KINDS.map((value) => ({ value, label: value })),
    },
    {
      name: "category",
      label: "Area",
      type: "select",
      options: WORK_CATEGORIES.map((value) => ({ value, label: value })),
    },
    { name: "stack", label: "Stack", type: "lines", rows: 4, hint: "One technology per line." },
    {
      name: "repo",
      label: "Repository",
      type: "text",
      placeholder: "https://github.com/leffloard/…",
      hint: "Only for open-source projects. A private project never links to its code.",
    },
    { name: "featured", label: "Featured on the home page", type: "boolean" },
    {
      name: "highlights",
      label: "Highlights",
      type: "lines",
      rows: 3,
      hint: "Two or three short, checkable facts for the card, one per line.",
    },
    { name: "status", label: "Status", type: "text", placeholder: "In daily use." },
    {
      name: "body",
      label: "Case study",
      type: "markdown",
      hint: "Markdown. Each ## heading starts a numbered section. Images come from the media library.",
    },
  ],
  post: [
    { name: "title", label: "Title", type: "text" },
    slug("/blog/"),
    {
      name: "description",
      label: "Description",
      type: "textarea",
      rows: 2,
      hint: "Search engines and link previews show it.",
    },
    { name: "date", label: "Date", type: "date" },
    { name: "tags", label: "Tags", type: "lines", rows: 2, hint: "One per line, lower case." },
    { name: "body", label: "Post", type: "markdown", hint: "Markdown, with code blocks and ## headings." },
  ],
  service: [
    { name: "title", label: "Title", type: "text" },
    slug("/services/"),
    { name: "short", label: "One line", type: "text" },
    { name: "intro", label: "Introduction", type: "textarea", rows: 3 },
    { name: "forWhom", label: "Good fit for", type: "textarea", rows: 2 },
    {
      name: "packages",
      label: "Packages",
      type: "list",
      itemLabel: "Package",
      item: [
        { name: "name", label: "Name", type: "text" },
        { name: "price", label: "From (US dollars)", type: "number" },
        {
          name: "per",
          label: "Charged",
          type: "select",
          nullable: true,
          options: [
            { value: "", label: "Once" },
            { value: "month", label: "Every month" },
          ],
        },
        { name: "summary", label: "Summary", type: "text" },
        { name: "includes", label: "Includes", type: "lines", rows: 4, hint: "One per line." },
        {
          name: "revisions",
          label: "Revision rounds",
          type: "number",
          nullable: true,
          hint: "Empty: agreed per project.",
        },
        { name: "timeline", label: "Timeline", type: "text", placeholder: "About 2 weeks" },
        { name: "highlighted", label: "Highlight as the most chosen", type: "boolean" },
      ],
      empty: emptyPackage,
    },
    {
      name: "addOns",
      label: "Add-ons",
      type: "list",
      itemLabel: "Add-on",
      item: [
        { name: "name", label: "Name", type: "text" },
        { name: "price", label: "Price", type: "text", placeholder: "$90 a page" },
      ],
      empty: { name: "", price: "" },
    },
    { name: "deliverables", label: "Deliverables", type: "lines", rows: 4, hint: "One per line." },
    { name: "proof", label: "Related work", type: "workRefs" },
    faq,
  ],
  testimonial: [
    { name: "quote", label: "Quote", type: "textarea", rows: 4 },
    { name: "name", label: "Name", type: "text" },
    { name: "role", label: "Role and company", type: "text", placeholder: "Founder, Example Co." },
    { name: "workSlug", label: "Project", type: "workRef" },
    { name: "consent", label: "They agreed to this being published", type: "boolean" },
    {
      name: "consentNote",
      label: "How they agreed",
      type: "textarea",
      rows: 2,
      hint: "Where and when (an email, a message). Never shown on the site.",
    },
  ],
  profile: [
    {
      name: "availability",
      label: "Availability badge",
      type: "group",
      fields: [
        { name: "open", label: "Taking new projects", type: "boolean" },
        { name: "openLabel", label: "Text while you take projects", type: "text" },
        { name: "closedLabel", label: "Text while you are booked", type: "text" },
      ],
    },
    {
      name: "pitch",
      label: "Pitch",
      type: "textarea",
      rows: 2,
      hint: "One sentence: the footer and search results.",
    },
    {
      name: "process",
      label: "How a project runs",
      type: "list",
      itemLabel: "Step",
      item: [
        { name: "title", label: "Step", type: "text" },
        { name: "text", label: "Description", type: "textarea", rows: 2 },
      ],
      empty: { title: "", text: "" },
    },
  ],
  cv: [
    { name: "headline", label: "Headline", type: "text" },
    { name: "summary", label: "Summary", type: "textarea", rows: 4 },
    {
      name: "experience",
      label: "Experience",
      type: "list",
      itemLabel: "Role",
      item: [
        { name: "role", label: "Role", type: "text" },
        { name: "place", label: "Where", type: "text" },
        { name: "period", label: "When", type: "text", placeholder: "2018 – present" },
        { name: "points", label: "What you did", type: "lines", rows: 4, hint: "One per line." },
      ],
      empty: { role: "", place: "", period: "", points: [] },
    },
    {
      name: "education",
      label: "Education",
      type: "list",
      itemLabel: "School",
      item: [
        { name: "place", label: "Where", type: "text" },
        { name: "detail", label: "What", type: "text" },
        { name: "period", label: "When", type: "text" },
      ],
      empty: { place: "", detail: "", period: "" },
    },
    {
      name: "skills",
      label: "Skills",
      type: "list",
      itemLabel: "Group",
      item: [
        { name: "group", label: "Group", type: "text" },
        { name: "items", label: "Skills", type: "lines", rows: 3, hint: "One per line." },
        { name: "proof", label: "Seen in", type: "workRefs" },
      ],
      empty: { group: "", items: [], proof: [] },
    },
    {
      name: "languages",
      label: "Languages",
      type: "list",
      itemLabel: "Language",
      item: [
        { name: "name", label: "Language", type: "text" },
        { name: "level", label: "Level", type: "text" },
      ],
      empty: { name: "", level: "" },
    },
  ],
  pricing: [
    {
      name: "paymentTerms",
      label: "Payment terms",
      type: "list",
      itemLabel: "Term",
      item: [
        { name: "title", label: "Amount", type: "text", placeholder: "Under $500" },
        { name: "text", label: "Terms", type: "text" },
      ],
      empty: { title: "", text: "" },
    },
    { name: "terms", label: "Terms list", type: "lines", rows: 6, hint: "One per line." },
    {
      name: "paymentMethods",
      label: "Payment methods",
      type: "list",
      itemLabel: "Method",
      item: [
        { name: "name", label: "Method", type: "text" },
        { name: "note", label: "Note", type: "text" },
      ],
      empty: { name: "", note: "" },
    },
    faq,
  ],
};

// A new item's starting values.
export function emptyContent<K extends ContentKind>(kind: K, today: string): ContentInput[K] {
  const empty: { [Kind in ContentKind]: ContentInput[Kind] } = {
    work: {
      slug: "",
      title: "",
      tagline: "",
      summary: "",
      year: today.slice(0, 4),
      kind: "Open source",
      category: "Web",
      stack: [],
      repo: "",
      featured: false,
      highlights: [],
      status: "",
      body: "## Problem\n\n\n\n## Approach\n\n\n\n## Result\n\n",
    },
    post: { slug: "", title: "", description: "", date: today, tags: [], body: "" },
    service: {
      slug: "",
      title: "",
      short: "",
      intro: "",
      forWhom: "",
      packages: [{ ...emptyPackage }],
      addOns: [],
      deliverables: [],
      proof: [],
      faq: [],
    },
    testimonial: { quote: "", name: "", role: "", workSlug: "", consent: false, consentNote: "" },
    profile: {
      availability: { open: true, openLabel: "", closedLabel: "" },
      pitch: "",
      process: [],
    },
    cv: { headline: "", summary: "", experience: [], education: [], skills: [], languages: [] },
    pricing: { paymentTerms: [], terms: [], paymentMethods: [], faq: [] },
  };
  return empty[kind];
}

// Drops the empty lines of "lines" fields before saving (they are kept while typing).
export function withoutEmptyLines(value: unknown, fields: FieldSpec[]): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const result: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const field of fields) {
    const inner = result[field.name];
    if (field.type === "lines" && Array.isArray(inner)) {
      result[field.name] = inner.map((line) => String(line).trim()).filter(Boolean);
    } else if (field.type === "group") {
      result[field.name] = withoutEmptyLines(inner, field.fields);
    } else if (field.type === "list" && Array.isArray(inner)) {
      result[field.name] = inner.map((item) => withoutEmptyLines(item, field.item));
    }
  }
  return result;
}
