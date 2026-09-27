// Text rules for everything visitors send. Ported from the v1 backend (schemas.py, clean_text), so the
// same input is accepted or refused with the same message. Shared by the forms and the server.

// Python's str.strip() removes what str.isspace() calls whitespace; JavaScript's trim() differs on
// \x1c-\x1f, \x85 and \ufeff, so the set is spelled out.
const SPACE =
  "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const EDGE_SPACE = new RegExp(`^[${SPACE}]+|[${SPACE}]+$`, "g");

// Unicode category Cc. Multi-line text may keep \t and \n.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const CONTROL_MULTILINE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

export type TextRule = {
  maxLength: number;
  required?: boolean;
  multiline?: boolean;
  requiredMessage?: string;
};

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

export function invalid(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

// Length as Python counts it: code points, so an emoji is one character, not two.
export function codePointLength(text: string): number {
  return [...text].length;
}

/**
 * Normalises a text field: unifies line breaks (U+2028/U+2029 count as breaks, since email headers treat
 * them so), strips surrounding whitespace, refuses control characters and enforces the length. Empty text
 * becomes null, or an error when the field is required.
 */
export function cleanText(value: unknown, rule: TextRule): Checked<string | null> {
  const raw = value ?? "";
  if (typeof raw !== "string") return invalid("Must be text.");
  let text = rule.multiline
    ? raw.replace(/\r\n?/g, "\n").replace(/[\u2028\u2029]/g, "\n")
    : raw.replace(/[\u2028\u2029]/g, " ");
  text = text.replace(EDGE_SPACE, "");
  if (!text) {
    return rule.required
      ? invalid(rule.requiredMessage ?? "This field is required.")
      : { ok: true, value: null };
  }
  if ((rule.multiline ? CONTROL_MULTILINE : CONTROL).test(text)) {
    return invalid("Contains characters that are not allowed.");
  }
  if (codePointLength(text) > rule.maxLength)
    return invalid(`Must be ${rule.maxLength} characters or fewer.`);
  return { ok: true, value: text };
}
