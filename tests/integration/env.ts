import { afterAll, beforeAll, vi } from "vitest";
import { clearEnvCache } from "@/server/env";
import { TEST_ENCRYPTION_KEYS } from "../helpers/env";

// Configuration for server modules that read getEnv() (encryption, WebAuthn relying party, ...).
export function setupTestEnv(extra: Record<string, string> = {}): void {
  beforeAll(() => {
    vi.stubEnv("MONGO_URL", "mongodb://127.0.0.1:1/unused");
    vi.stubEnv("DATA_ENCRYPTION_KEYS", TEST_ENCRYPTION_KEYS);
    vi.stubEnv("SITE_URL", "https://leffloard.test");
    for (const [name, value] of Object.entries(extra)) vi.stubEnv(name, value);
    clearEnvCache();
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    clearEnvCache();
  });
}
