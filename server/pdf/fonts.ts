import "server-only";
import path from "node:path";
import { Font } from "@react-pdf/renderer";

// The PDFs' typeface (the CV's, and quotes' and invoices'), registered once per process. The files are read by
// path at render time; next.config.ts keeps them in the standalone build.
const FONT_DIR = path.join(process.cwd(), "node_modules", "geist", "dist", "fonts", "geist-sans");

let registered = false;

export function registerPdfFonts(): void {
  if (registered) return;
  registered = true;
  Font.register({
    family: "Geist",
    fonts: [
      { src: path.join(FONT_DIR, "Geist-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "Geist-Medium.ttf"), fontWeight: 500 },
      { src: path.join(FONT_DIR, "Geist-SemiBold.ttf"), fontWeight: 600 },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
}
