import "server-only";
import type { Db, Document } from "mongodb";
import type { ContentDoc, ContentStateDoc, ContentVersionDoc, GithubRepoDoc } from "@/server/content/types";

export function contentItems(db: Db) {
  return db.collection<ContentDoc>("content");
}
export function contentVersions(db: Db) {
  return db.collection<ContentVersionDoc>("content_versions");
}
export function contentState(db: Db) {
  return db.collection<ContentStateDoc>("content_state");
}
export function githubRepos(db: Db) {
  return db.collection<GithubRepoDoc>("github_repos");
}

// Writes of a draft or published copy: their shape depends on the item's kind, which is wider than the
// driver's update types follow. The editor (server/content/editor.ts) checks the shapes itself.
export function contentWrites(db: Db) {
  return db.collection<Document>("content");
}
