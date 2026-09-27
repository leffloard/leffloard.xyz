// Search boxes match text anywhere in a field, case-insensitively. The visitor's or owner's text is
// escaped, so it is never read as a regular expression.

export const MAX_SEARCH_LENGTH = 200;

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A MongoDB condition for "contains this text", or null for an empty search.
export function containsPattern(query: string | null | undefined): { $regex: string; $options: "i" } | null {
  const text = query?.trim().slice(0, MAX_SEARCH_LENGTH);
  return text ? { $regex: escapeRegex(text), $options: "i" } : null;
}

// A condition for "equals this text, ignoring case" (email addresses).
export function equalsIgnoringCase(text: string): { $regex: string; $options: "i" } {
  return { $regex: `^${escapeRegex(text)}$`, $options: "i" };
}
