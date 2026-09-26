import { test as base, expect, type Page } from "@playwright/test";

export { expect };

// Collects console errors (CSP violations included), uncaught exceptions and failed requests, and fails
// the test if any show up. Pages from extra contexts join in with watchPage().
type Fixtures = { allowedErrors: RegExp[]; browserErrors: string[] };

export function watchPage(page: Page, errors: string[]): void {
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`exception: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`http ${response.status()}: ${response.url()}`);
  });
}

export const test = base.extend<Fixtures>({
  allowedErrors: [[], { option: true }],
  browserErrors: [
    async ({ page, allowedErrors }, use) => {
      const errors: string[] = [];
      watchPage(page, errors);
      await use(errors);
      expect(errors.filter((error) => !allowedErrors.some((pattern) => pattern.test(error)))).toEqual([]);
    },
    { auto: true },
  ],
});
