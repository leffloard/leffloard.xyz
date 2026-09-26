import type { MetadataRoute } from "next";
import { site } from "@/content/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api/", "/portal", "/q/", "/i/", "/pay", "/meeting/"],
      },
    ],
    sitemap: `${site.origin}/sitemap.xml`,
    host: site.origin,
  };
}
