// Making visitor text safe for Discord and email headers. Ported from the v1 backend (notify.py): the same
// characters are escaped, so a message can't ping @everyone, hide a link or break out of a header.

const MARKDOWN_CHARACTERS = /([\\`*_~|[\]()<>#])/g;
const LIST_MARKERS = /^(\s*)([-+])(?=\s)/gm;
const MASS_MENTIONS = /@(everyone|here)/gi;
const ENCODED_WORD = /=\?[^?]*\?[bBqQ]\?.*?\?=/;
// Python's str.split() whitespace, as used by the v1 header_text().
const WHITESPACE = /[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;

export const DISCORD_FIELD_LIMIT = 1024;
export const DISCORD_DESCRIPTION_LIMIT = 3000;

// Cuts at a code point boundary and marks the cut with an ellipsis.
export function truncate(text: string, limit: number): string {
  const characters = Array.from(text);
  if (characters.length <= limit) return text;
  return `${characters
    .slice(0, limit - 1)
    .join("")
    .trimEnd()}…`;
}

export function discordSafe(text: string, limit: number = DISCORD_FIELD_LIMIT): string {
  const escaped = text
    .replace(MARKDOWN_CHARACTERS, "\\$1")
    .replace(LIST_MARKERS, "$1\\$2")
    .replace(MASS_MENTIONS, "@\u200b$1");
  return truncate(escaped, limit);
}

/**
 * Keeps visitor text on one header line, and stops mail clients from decoding RFC 2047 encoded words
 * hidden in it ("=?utf-8?q?...?=" could otherwise smuggle a line break into what the reader sees).
 */
export function headerText(text: string): string {
  const oneLine = text.split(WHITESPACE).filter(Boolean).join(" ");
  return ENCODED_WORD.test(oneLine) ? oneLine.replaceAll("=?", "= ?") : oneLine;
}
