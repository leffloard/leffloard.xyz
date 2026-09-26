import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  // Browsers ignore HSTS over plain http, so local production builds are unaffected.
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]
    : []),
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // Keeps the development badge away from the admin sidebar's sign-out button.
  devIndicators: { position: "bottom-right" },
  experimental: {
    globalNotFound: true,
    // forbidden() for requests that Cloudflare Access did not let through.
    authInterrupts: true,
  },
  // Packages that load files at runtime (fonts, grammars) stay outside the server bundle.
  serverExternalPackages: ["@react-pdf/renderer", "shiki", "@shikijs/rehype"],
  // Files read by path on request, which the standalone output would otherwise leave behind: the fonts of
  // the PDFs and the link preview images, and the blog posts a new database starts with (server/content).
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf",
      "./node_modules/geist/dist/fonts/geist-sans/Geist-Medium.ttf",
      "./node_modules/geist/dist/fonts/geist-sans/Geist-SemiBold.ttf",
      "./node_modules/geist/dist/fonts/geist-mono/GeistMono-Regular.ttf",
      "./content/blog/*.md",
    ],
  },
  async redirects() {
    return [
      // v1 addresses: the request form opened with ?type=..., and four template blog posts. An
      // appointment link goes to the booking page, the other types to the contact form.
      {
        source: "/",
        has: [{ type: "query", key: "type", value: "appointment" }],
        destination: "/book",
        permanent: false,
      },
      { source: "/", has: [{ type: "query", key: "type" }], destination: "/contact", permanent: false },
      { source: "/blog/:id(\\d+)", destination: "/blog", permanent: true },
      // Browsers ask for /favicon.ico whatever a page declares; the site's icon is the SVG.
      { source: "/favicon.ico", destination: "/icon.svg", permanent: true },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
