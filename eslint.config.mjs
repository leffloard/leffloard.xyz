import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    ".data/**",
    // The v1 app (removed after the cut-over).
    "frontend/**",
    "backend/**",
  ]),
  {
    // The service's launcher is plain CommonJS: it runs next to the standalone server without a build step.
    files: ["deploy/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);
