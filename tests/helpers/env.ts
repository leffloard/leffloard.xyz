// Fixed, obviously fake keys for tests (32 bytes each).
export const TEST_KEY_1 = Buffer.alloc(32, 1).toString("base64");
export const TEST_KEY_2 = Buffer.alloc(32, 2).toString("base64");
export const TEST_ENCRYPTION_KEYS = `1:${TEST_KEY_1}`;

export const TEST_ENV_SOURCE = {
  MONGO_URL: "mongodb+srv://user:pass@cluster0.example.mongodb.net/?appName=leff",
  DATA_ENCRYPTION_KEYS: TEST_ENCRYPTION_KEYS,
} as const;
