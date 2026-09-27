import type {
  CvData,
  PackageData,
  PostData,
  PricingData,
  ProfileData,
  ServiceData,
  TestimonialData,
  WorkData,
} from "@/lib/content/schemas";

// Content as the site stores and shows it: what the editor wrote, plus what the server rendered from it
// (Markdown as sanitized HTML, headings, reading time). Pure types and helpers, usable anywhere.

export type Heading = { id: string; text: string };
export type WorkSection = { heading: string; id: string; html: string };

export type Stored = {
  work: WorkData & { lead: string; sections: WorkSection[] };
  post: PostData & { html: string; headings: Heading[]; readingMinutes: number };
  service: ServiceData;
  testimonial: TestimonialData;
  profile: ProfileData;
  cv: CvData;
  pricing: PricingData;
};

export type WorkItem = Stored["work"];
export type Post = Stored["post"];
export type PostMeta = Omit<Post, "body" | "html" | "headings">;
export type Service = ServiceData;
export type Package = PackageData;

// A testimonial as visitors see it: never the private note about the person's permission.
export type Testimonial = { id: string; quote: string; name: string; role: string; workSlug: string | null };

// A public GitHub repository the owner chose to list on the work page.
export type Repo = {
  name: string;
  url: string;
  description: string;
  language: string | null;
  stars: number;
  pushedAt: string | null; // YYYY-MM-DD
};

export type SiteContent = {
  profile: ProfileData;
  cv: CvData;
  pricing: PricingData;
  work: WorkItem[];
  posts: Post[]; // newest first
  services: Service[];
  testimonials: Testimonial[];
  repos: Repo[]; // the ones the owner chose, most recently pushed first
  repoStats: Record<string, { stars: number; pushedAt: string | null }>; // every synced one, by address
};

export function findWork(content: Pick<SiteContent, "work">, slug: string): WorkItem | undefined {
  return content.work.find((item) => item.slug === slug);
}

export function findService(content: Pick<SiteContent, "services">, slug: string): Service | undefined {
  return content.services.find((service) => service.slug === slug);
}

export function findPost(content: Pick<SiteContent, "posts">, slug: string): Post | undefined {
  return content.posts.find((post) => post.slug === slug);
}

export function publicRepoCount(content: Pick<SiteContent, "work">): number {
  return content.work.filter((item) => item.repo).length;
}

export function postTags(content: Pick<SiteContent, "posts">): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const post of content.posts) {
    for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

// "26 September 2026" (the date as written, if it is not one).
export function formatPostDate(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return date;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(day);
}
