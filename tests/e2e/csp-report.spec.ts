import { withDb } from "./helpers";
import { expect, test } from "./test";

test("CSP reports are stored without link tokens and always answered with 204", async ({ request }) => {
  const report = {
    "csp-report": {
      "document-uri": "http://localhost:3100/q/abcdefghijklmnop?ref=mail",
      "violated-directive": "script-src-elem",
      "effective-directive": "script-src-elem",
      "blocked-uri": "https://evil.example/x.js?token=1",
      disposition: "enforce",
    },
  };
  const response = await request.post("/api/csp-report", {
    headers: { "content-type": "application/csp-report" },
    data: JSON.stringify(report),
  });
  expect(response.status()).toBe(204);
  expect((await request.post("/api/csp-report", { data: "not json" })).status()).toBe(204);

  const stored = await withDb((db) => db.collection("csp_reports").findOne({ directive: "script-src-elem" }));
  expect(stored).toMatchObject({
    documentUrl: "http://localhost:3100/q/:token",
    blockedUrl: "https://evil.example/x.js",
  });
});
