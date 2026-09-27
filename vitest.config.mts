import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root("./"),
      "server-only": root("./tests/mocks/empty.ts"),
    },
  },
  test: {
    // Security events are logged as warnings; tests check them in the database instead.
    env: { LOG_LEVEL: "silent" },
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          testTimeout: 20_000,
          // The first run downloads the MongoDB binary.
          hookTimeout: 180_000,
        },
      },
      {
        // Attacks on the whole surface: every action and route without a session, hostile input on every
        // public endpoint, headers, cookies, Markdown and uploads (tests/security).
        extends: true,
        test: {
          name: "security",
          include: ["tests/security/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
