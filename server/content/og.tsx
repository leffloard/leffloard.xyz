import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

// Social preview images in the site's drawing style: dark canvas, frame lines, one accent.
export const ogSize = { width: 1200, height: 630 };

const FONTS = path.join(process.cwd(), "node_modules", "geist", "dist", "fonts");

const fonts = Promise.all([
  readFile(path.join(FONTS, "geist-sans", "Geist-SemiBold.ttf")),
  readFile(path.join(FONTS, "geist-mono", "GeistMono-Regular.ttf")),
]);

export async function ogImage({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  const [sans, mono] = await fonts;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#090a0c",
        color: "#f4f5f7",
        padding: "64px 72px",
        border: "1px solid #1f2126",
        fontFamily: "Geist",
        position: "relative",
      }}
    >
      <div style={{ position: "absolute", left: 40, top: 0, bottom: 0, width: 1, background: "#1c1e23" }} />
      <div style={{ position: "absolute", right: 40, top: 0, bottom: 0, width: 1, background: "#1c1e23" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: "#f4f5f7",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 16,
              height: 22,
              borderLeft: "5px solid #090a0c",
              borderBottom: "5px solid #090a0c",
            }}
          />
        </div>
        <span style={{ fontFamily: "Geist Mono", fontSize: 22, letterSpacing: 3, color: "#9aa0ab" }}>
          LEFFLOARD.XYZ · {eyebrow.toUpperCase()}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div
          style={{
            fontSize: title.length > 40 ? 64 : 78,
            lineHeight: 1.02,
            letterSpacing: -2.5,
            maxWidth: 1000,
          }}
        >
          {title}
        </div>
        {subtitle ? (
          <div style={{ fontSize: 30, lineHeight: 1.35, color: "#9aa0ab", maxWidth: 980 }}>{subtitle}</div>
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontFamily: "Geist Mono",
          fontSize: 20,
          color: "#4ae9f9",
        }}
      >
        <div style={{ width: 10, height: 10, borderRadius: 5, background: "#4ae9f9" }} />
        Mert Kaan Koparan · Independent software developer
      </div>
    </div>,
    {
      ...ogSize,
      fonts: [
        { name: "Geist", data: sans, weight: 600, style: "normal" },
        { name: "Geist Mono", data: mono, weight: 400, style: "normal" },
      ],
    },
  );
}
