import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL } from "./tests/e2e/fixtures";

const chromium = {
  ...devices["Desktop Chrome"],
  // For machines with a preinstalled Chromium instead of "npx playwright install chromium".
  launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
};

// Runs against the production build: "npm run build", then "npm run test:e2e".
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /(admin-(inbox|settings|work)|calendar|billing|portal|content)\.spec\.ts/,
      use: chromium,
    },
    {
      // Admin modules sign in with a session written to the database. They run after the sign-in tests,
      // which sign out every other session on purpose.
      name: "admin-modules",
      testMatch: /admin-(inbox|settings)\.spec\.ts/,
      dependencies: ["chromium"],
      use: chromium,
    },
    {
      // Clients, projects, tasks and time: after the inbox tests, which count every inbox message.
      name: "admin-work",
      testMatch: /admin-work\.spec\.ts/,
      dependencies: ["admin-modules"],
      use: chromium,
    },
    {
      // Booking and the calendar: last, as they reset the calendar's hours and booking types.
      name: "calendar",
      testMatch: /calendar\.spec\.ts/,
      dependencies: ["admin-work"],
      use: chromium,
    },
    {
      // Quotes, invoices and payments: after the calendar, one step after another.
      name: "billing",
      testMatch: /billing\.spec\.ts/,
      dependencies: ["calendar"],
      use: chromium,
    },
    {
      // The client portal: after billing, whose projects it checks it can't see.
      name: "portal",
      testMatch: /portal\.spec\.ts/,
      dependencies: ["billing"],
      use: chromium,
    },
    {
      // The content editor: last, as it changes what the public pages show.
      name: "content",
      testMatch: /content\.spec\.ts/,
      dependencies: ["portal"],
      use: chromium,
    },
  ],
  webServer: {
    command: "node --conditions=react-server --import tsx scripts/e2e-server.ts",
    url: `${E2E_BASE_URL}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
    stdout: "pipe",
    stderr: "pipe",
  },
});
