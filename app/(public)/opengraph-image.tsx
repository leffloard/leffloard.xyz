import { ogImage, ogSize } from "@/server/content/og";

export const alt = "Mert Kaan Koparan, independent software developer";
export const size = ogSize;
export const contentType = "image/png";

export default function Image() {
  return ogImage({
    eyebrow: "Portfolio",
    title: "Software that holds up.",
    subtitle: "Websites, web apps, Discord bots, sign-in systems and desktop software.",
  });
}
