import "server-only";
import type { Db } from "mongodb";
import type {
  PortalLinkDoc,
  PortalSessionDoc,
  PrivacyRequestDoc,
  ProjectUpdateDoc,
} from "@/server/portal/types";

export function portalLinks(db: Db) {
  return db.collection<PortalLinkDoc>("portal_links");
}
export function portalSessions(db: Db) {
  return db.collection<PortalSessionDoc>("portal_sessions");
}
export function projectUpdates(db: Db) {
  return db.collection<ProjectUpdateDoc>("project_updates");
}
export function privacyRequests(db: Db) {
  return db.collection<PrivacyRequestDoc>("privacy_requests");
}
