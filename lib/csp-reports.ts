// Turns browser CSP reports (the old "csp-report" format and the Reporting API format) into one shape,
// without link tokens or query strings from the page address.

export type CspReport = {
  documentUrl: string;
  directive: string;
  blockedUrl: string;
  sourceFile: string;
  line: number | null;
  disposition: string;
  sample: string;
};

const LINK_PAGES = /^\/(q|i|meeting|portal\/login)\/[^/]+/;

export function redactUrl(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  if (!/^https?:/i.test(value)) return value.slice(0, 60); // "inline", "eval", "data", ...
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(LINK_PAGES, "/$1/:token")}`.slice(0, 300);
  } catch {
    return "";
  }
}

function text(value: unknown, max = 200): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function toReport(fields: Record<string, unknown>, legacy: boolean): CspReport | null {
  const pick = (modern: string, old: string) => fields[legacy ? old : modern];
  const directive =
    text(pick("effectiveDirective", "effective-directive")) || text(fields["violated-directive"]);
  if (!directive) return null;
  const line = Number(pick("lineNumber", "line-number"));
  return {
    documentUrl: redactUrl(pick("documentURL", "document-uri")),
    directive,
    blockedUrl: redactUrl(pick("blockedURL", "blocked-uri")),
    sourceFile: redactUrl(pick("sourceFile", "source-file")),
    line: Number.isFinite(line) && line > 0 ? line : null,
    disposition: text(fields.disposition, 20) || "enforce",
    sample: text(pick("sample", "script-sample"), 120),
  };
}

export function normalizeCspReports(body: unknown): CspReport[] {
  if (Array.isArray(body)) {
    return body
      .filter((entry) => entry && typeof entry === "object" && entry.type === "csp-violation" && entry.body)
      .map((entry) => toReport(entry.body as Record<string, unknown>, false))
      .filter((report): report is CspReport => report !== null)
      .slice(0, 10);
  }
  if (body && typeof body === "object" && "csp-report" in body) {
    const report = toReport((body as { "csp-report": Record<string, unknown> })["csp-report"] ?? {}, true);
    return report ? [report] : [];
  }
  return [];
}
