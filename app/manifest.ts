import type { MetadataRoute } from "next";
import { site } from "@/content/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${site.name} · leffloard.xyz`,
    short_name: "leffloard",
    description: site.pitch,
    start_url: "/",
    display: "browser",
    background_color: "#090a0c",
    theme_color: "#090a0c",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
