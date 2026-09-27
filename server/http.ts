import "server-only";
import { hasUnsafeKeys } from "@/server/security/nosql";
import { isSameOriginRequest } from "@/server/security/origin";

// JSON answers from route handlers are never cached.
export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

// Reads a request body as text, giving up (null) once it is larger than `maxBytes`, so a huge body is never
// buffered in full.
export async function readBodyText(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export type JsonBody = { ok: true; fields: Record<string, unknown> } | { ok: false; response: Response };

// The checks every public JSON POST starts with: same origin, JSON, a size limit, a plain object without
// operator-like keys. On failure, `response` is the answer to send.
export async function readJsonPost(
  request: Request,
  { siteUrl, maxBytes }: { siteUrl: string; maxBytes: number },
): Promise<JsonBody> {
  if (!isSameOriginRequest(request.headers, siteUrl)) {
    return {
      ok: false,
      response: jsonResponse({ error: "Cross-site posts are not accepted.", code: "origin" }, 403),
    };
  }
  if (!/^application\/json\b/.test(request.headers.get("content-type") ?? "")) {
    return { ok: false, response: jsonResponse({ error: "Send the form as JSON." }, 415) };
  }
  const text = await readBodyText(request, maxBytes);
  if (text === null)
    return { ok: false, response: jsonResponse({ error: "The request is too large." }, 413) };
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, response: jsonResponse({ error: "The request could not be read." }, 400) };
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload) || hasUnsafeKeys(payload)) {
    return { ok: false, response: jsonResponse({ error: "The request could not be read." }, 400) };
  }
  return { ok: true, fields: payload as Record<string, unknown> };
}
