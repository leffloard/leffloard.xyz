import path from "node:path";

// Shared by the Playwright specs and scripts/e2e-server.ts.
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
// "localhost", not 127.0.0.1: passkeys need a domain name as their relying party.
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;
export const E2E_HEALTH_TOKEN = "e2e-health-token-not-a-secret-0000";
export const E2E_DB_NAME = "leffloard_e2e";
export const E2E_ENCRYPTION_KEYS = `1:${Buffer.alloc(32, 7).toString("base64")}`;
export const E2E_BACKUP_KEY = Buffer.alloc(32, 8).toString("base64");
// NOWPayments and TCMB, played by a local mock (scripts/lib/e2e-mocks.ts).
export const E2E_MOCK_PORT = Number(process.env.E2E_MOCK_PORT ?? 3199);
export const E2E_MOCK_URL = `http://127.0.0.1:${E2E_MOCK_PORT}`;
export const E2E_NOWPAYMENTS = {
  apiKey: "e2e-nowpayments-api-key-not-a-secret",
  ipnSecret: "e2e-nowpayments-ipn-secret-not-a-secret",
} as const;
// The mock's TCMB bulletins: lira per unit, every weekday.
export const E2E_RATES = { USD: "40.0000", EUR: "47.0000", GBP: "52.0000" } as const;
// Absolute: the standalone server runs in its own folder.
export const E2E_BACKUP_DIR = path.resolve(".data/e2e-backups");
// Written by the e2e server so specs can inspect or adjust the throwaway database.
export const E2E_MONGO_URL_FILE = ".data/e2e-mongo-url.txt";

export const OWNER = {
  email: "owner@example.com",
  name: "Test Owner",
  password: "purple kettle on the balcony",
} as const;
