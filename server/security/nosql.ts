// Keys that could turn user data into a MongoDB operator or pollute prototypes. Input with such keys is
// refused before validation (the strict zod schemas would drop most of them, this makes it explicit).
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 32;

export function hasUnsafeKeys(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return true;
  if (Array.isArray(value)) return value.some((item) => hasUnsafeKeys(item, depth + 1));
  if (value === null || typeof value !== "object") return false;
  for (const key of Object.keys(value)) {
    if (key.startsWith("$") || key.includes(".") || FORBIDDEN_KEYS.has(key)) return true;
    if (hasUnsafeKeys((value as Record<string, unknown>)[key], depth + 1)) return true;
  }
  return false;
}
