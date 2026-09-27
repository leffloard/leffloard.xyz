import "server-only";
import { CONTENT_KINDS, type ContentKind } from "@/lib/content/schemas";

// The kind in a content editor address (/admin/content/<kind>), if it is one.
export function kindParam(value: string): ContentKind | null {
  return (CONTENT_KINDS as readonly string[]).includes(value) ? (value as ContentKind) : null;
}
