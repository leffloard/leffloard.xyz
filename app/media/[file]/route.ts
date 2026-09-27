import { readMedia } from "@/server/content/media";
import { getDb } from "@/server/db/client";

// An image from the media library. Its address is the hash of its bytes, so it never changes: browsers and
// Cloudflare may keep it for a year.

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const match = /^([a-f0-9]{64})\.webp$/.exec((await params).file);
  const media = match ? await readMedia(await getDb(), match[1]!) : null;
  if (!media) return new Response("Not found.", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(new Uint8Array(media.bytes), {
    headers: {
      "content-type": media.contentType,
      "content-length": String(media.bytes.length),
      "cache-control": "public, max-age=31536000, immutable",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
