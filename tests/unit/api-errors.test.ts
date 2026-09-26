import { MongoError } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as unknownApi from "@/app/api/[[...path]]/route";
import { POST as postInquiry } from "@/app/api/inquiries/route";
import { POST as postRequest } from "@/app/api/requests/route";
import { getDb } from "@/server/db/client";
import { clearEnvCache } from "@/server/env";
import { TEST_ENV_SOURCE } from "../helpers/env";

// v1's "errors never leak details" and "unknown API paths stay JSON" tests.

vi.mock("@/server/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/server/notify/kick", () => ({ sendQueuedSoon: vi.fn() }));

beforeAll(() => {
  for (const [key, value] of Object.entries(TEST_ENV_SOURCE)) vi.stubEnv(key, value);
  clearEnvCache();
});

afterAll(() => {
  vi.unstubAllEnvs();
  clearEnvCache();
});

const question = {
  type: "inquiry",
  name: "Alan Turing",
  email: "alan@example.com",
  subject: "Pricing",
  message: "How much?",
};

function request(path: string, body: unknown): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify(body),
  });
}

describe("API errors", () => {
  it("say the database is unavailable without its details", async () => {
    vi.mocked(getDb).mockRejectedValue(new MongoError("localhost:27017: connection refused, Timeout: 10s"));
    const response = await postRequest(request("/api/requests", question));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      detail: "The service is temporarily unavailable. Please try again later.",
    });

    const form = await postInquiry(
      request("/api/inquiries", { ...question, kind: "question", type: undefined }),
    );
    expect(form.status).toBe(503);
    expect(await form.text()).not.toContain("27017");
  });

  it("answer anything unexpected with a generic message", async () => {
    vi.mocked(getDb).mockRejectedValue(new Error("secret internals"));
    const response = await postRequest(request("/api/requests", question));
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ detail: "Internal server error." });
    expect(text).not.toContain("secret internals");
  });

  it.each(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const)(
    "answer unknown API addresses with JSON (%s)",
    async (method) => {
      const response = unknownApi[method]();
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toMatch(/^application\/json/);
      expect(await response.json()).toEqual({ detail: "Not Found" });
    },
  );
});
