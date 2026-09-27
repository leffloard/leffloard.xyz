import localFont from "next/font/local";

// Geist Sans and Mono (SIL Open Font License, OFL.txt) as the pages use them: the variable fonts from the
// `geist` package (whose TTF files the PDFs and share images use), cut down to the Latin letters of Western
// European languages and Turkish, punctuation, currency signs and arrows (and, for Mono, the box drawing that
// code blocks use), with only the layout features the site uses. 65 KB for both instead of 138 KB, which
// keeps the pages within their font budget (tests/e2e/budgets.spec.ts). Any other character falls back to
// the system's font of the same kind; the options below are the package's own.
//
// Made with fontTools (pip install fonttools brotli), from node_modules/geist/dist/fonts/geist-sans and
// geist-mono, when the `geist` package is updated:
//
//   LATIN=U+0000-00FF,U+0100-017F,U+0192,U+0218-021B,U+02BB-02BC,U+02C6,U+02C7,U+02D8-02DD,U+0300-0308,\
//   U+030A-030C,U+0326-0328,U+2000-206F,U+20AC,U+20BA,U+2122,U+2190-21FF,U+2212,U+2215,U+221E,U+2248,\
//   U+2260,U+2264,U+2265,U+2318,U+25CF,U+2713,U+2717,U+FEFF,U+FFFD
//   FEATURES=kern,liga,calt,ccmp,clig,locl,mark,mkmk,rlig,rvrn,tnum
//   pyftsubset Geist-Variable.woff2 --unicodes=$LATIN --layout-features=$FEATURES --flavor=woff2 \
//     --output-file=Geist-Variable.latin.woff2
//   pyftsubset GeistMono-Variable.woff2 --unicodes=$LATIN,U+2500-259F --layout-features=$FEATURES \
//     --flavor=woff2 --output-file=GeistMono-Variable.latin.woff2

export const GeistSans = localFont({
  src: "./Geist-Variable.latin.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
});

export const GeistMono = localFont({
  src: "./GeistMono-Variable.latin.woff2",
  variable: "--font-geist-mono",
  adjustFontFallback: false,
  fallback: [
    "ui-monospace",
    "SFMono-Regular",
    "Roboto Mono",
    "Menlo",
    "Monaco",
    "Liberation Mono",
    "DejaVu Sans Mono",
    "Courier New",
    "monospace",
  ],
  weight: "100 900",
});
