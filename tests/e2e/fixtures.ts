// Shared by the Playwright specs and scripts/e2e-server.ts.
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
export const E2E_HEALTH_TOKEN = "e2e-health-token-not-a-secret-0000";
export const E2E_DB_NAME = "leffloard_e2e";
