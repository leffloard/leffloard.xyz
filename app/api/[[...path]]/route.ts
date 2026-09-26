// Unknown API addresses answer in JSON, like the v1 backend did, instead of the site's HTML 404 page.

export const dynamic = "force-dynamic";

function notFound(): Response {
  return Response.json({ detail: "Not Found" }, { status: 404, headers: { "cache-control": "no-store" } });
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = notFound;
