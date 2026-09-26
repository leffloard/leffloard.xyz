import { site } from "@/content/site";
import { renderCvPdf } from "@/server/content/cv-pdf";
import { publishedContent } from "@/server/content/site";

// Made on request from the published content, like the /cv page.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const pdf = await renderCvPdf(await publishedContent());
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${site.name.replaceAll(" ", "-")}-CV.pdf"`,
    },
  });
}
