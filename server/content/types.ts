import type { ObjectId } from "mongodb";
import type { ContentKind } from "@/lib/content/schemas";
import type { Stored } from "@/lib/content/types";

// The public site's content in the database. Every item keeps two copies: the draft the editor works on,
// and the published one the site shows. Publishing copies the draft over (after the leak check) and keeps
// the old published copy as a version.

type Base = {
  _id: ObjectId;
  // The address name (slug) of the draft for work, posts and services; the id for testimonials; the kind
  // itself for the profile, the CV and the pricing terms. Unique per kind.
  key: string;
  publishedAt: Date | null; // when the published copy was last replaced
  publishAt: Date | null; // the draft is published at this moment (scheduled)
  changed: boolean; // the draft differs from the published copy
  rank: string; // order within the kind (lib/rank.ts)
  version: number; // of the draft, for saves from an older page
  createdAt: Date;
  updatedAt: Date;
};

export type ContentDoc = {
  [K in ContentKind]: Base & { kind: K; draft: Stored[K]; published: Stored[K] | null };
}[ContentKind];

export type ContentDocOf<K extends ContentKind> = Extract<ContentDoc, { kind: K }>;

// A published copy that was replaced or taken down, to look at or bring back into the draft.
export type ContentVersionDoc = {
  _id: ObjectId;
  contentId: ObjectId;
  kind: ContentKind;
  key: string;
  data: Stored[ContentKind];
  publishedAt: Date; // when this copy went live
  replacedAt: Date;
};

// One document: the content's generation, raised by every change to what the site shows, so each server
// process knows when to reload its copy.
export type ContentStateDoc = { _id: "site"; generation: number; seededAt: Date; updatedAt: Date };

// A public repository of the owner's, as last read from GitHub (server/content/github.ts).
export type GithubRepoDoc = {
  _id: string; // the repository's name, lower case
  name: string;
  url: string;
  description: string;
  language: string | null;
  stars: number;
  forks: number;
  topics: string[];
  pushedAt: Date | null;
  archived: boolean;
  fork: boolean;
  show: boolean; // listed on the work page (the owner's choice)
  syncedAt: Date;
};
