import { site } from "@/content/site";
import { renderCvPdf } from "@/server/content/cv-pdf";

// Generated at build time from content/cv.ts, like the /cv page.
export const dynamic = "force-static";

export async function GET(): Promise<Response> {
  const pdf = await renderCvPdf();
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${site.name.replaceAll(" ", "-")}-CV.pdf"`,
    },
  });
}
