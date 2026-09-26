import { currentAdmin } from "@/server/auth/dal";
import { MAX_UPLOAD_BYTES, storeImage } from "@/server/content/media";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { jsonResponse } from "@/server/http";
import { log } from "@/server/log";
import { isSameOriginRequest } from "@/server/security/origin";

// Uploads an image to the media library (multipart: "file" and "alt"). Behind the admin's sign-in and
// Cloudflare Access like the rest of /admin; only the site's own pages may post here.
//   201 { media }   400/413/415 the file   401 signed out   403 another site

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request.headers, getEnv().SITE_URL)) {
    return jsonResponse({ error: "Cross-site posts are not accepted." }, 403);
  }
  if (!(await currentAdmin())) return jsonResponse({ error: "Your session has ended. Sign in again." }, 401);
  // Refused before reading when the browser says it is too large; checked again on the bytes.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 64 * 1024) {
    return jsonResponse({ error: "Images can be up to 12 MB." }, 413);
  }
  if (!/^multipart\/form-data\b/.test(request.headers.get("content-type") ?? "")) {
    return jsonResponse({ error: "Send the image as a form upload." }, 415);
  }
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonResponse({ error: "Choose an image to upload." }, 400);
    if (file.size > MAX_UPLOAD_BYTES) return jsonResponse({ error: "Images can be up to 12 MB." }, 413);
    const alt = typeof form.get("alt") === "string" ? String(form.get("alt")) : "";
    const result = await storeImage(await getDb(), {
      bytes: new Uint8Array(await file.arrayBuffer()),
      name: file.name,
      alt,
    });
    if (!result.ok) return jsonResponse({ error: result.message }, 400);
    return jsonResponse({ media: result.media, existed: result.existed }, 201);
  } catch (error) {
    log.error({ err: error }, "POST /admin/media failed");
    return jsonResponse({ error: "The upload failed. Please try again." }, 500);
  }
}
