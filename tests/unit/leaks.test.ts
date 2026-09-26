import { describe, expect, it } from "vitest";
import { checkedText, findLeaks, publishedText } from "@/lib/content/leaks";

// Secrets for the tests are put together at run time, so no scanner mistakes this file for a leak.
const fake = (...parts: string[]) => parts.join("");

const rules = (text: string, banned: string[] = []) => findLeaks(text, banned).map((finding) => finding.rule);

describe("the leak check", () => {
  it.each([
    [fake("https://discord.com/api/", "webhooks/123456789012345678/abcDEF"), "discord-webhook"],
    ["the channel <#123456789012345678>", "discord-id"],
    [fake("mongodb+srv://leff:", "hunter2@cluster0.abcde.mongodb.net/leffloard"), "database-address"],
    [fake("-----BEGIN OPENSSH ", "PRIVATE KEY-----"), "private-key"],
    [fake("AKIA", "ABCDEFGHIJKLMNOP"), "aws-key"],
    [fake("sk-ant-", "api03-abcdefghijklmnopqrstuvwxyz"), "api-key"],
    [fake("ghp_", "abcdefghijklmnopqrstuvwxyz0123456789"), "github-token"],
    [fake("xoxb-", "1234567890-abcdefghij"), "slack-token"],
    [
      fake(
        "eyJhbGciOiJIUzI1NiJ9.",
        "eyJzdWIiOiIxMjM0NTY3ODkwIn0.",
        "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      ),
      "jwt",
    ],
    ["SMTP_PASSWORD=abcd1234efgh", "env-secret"],
    ["the server at 185.12.40.7 answers", "ip-address"],
    ["write to ada@client-company.com", "email"],
    ["call +90 532 123 45 67", "phone"],
    ["call 0532 123 45 67", "phone"],
  ])("finds %s", (text, rule) => {
    expect(rules(text)).toContain(rule);
  });

  it.each([
    "Bind to 127.0.0.1 and 0.0.0.0, documented as 203.0.113.9.",
    "Write to erzincanligotik@gmail.com or test@example.com.",
    "SMTP_PASSWORD=<your app password>",
    "EMAIL_DELIVERY=log",
    "Next.js 16.3.6 with 119 automated tests and 2026 prices.",
    "C++20, OpenGL 3.3 and GLSL.",
  ])("lets ordinary text through: %s", (text) => {
    expect(findLeaks(text)).toEqual([]);
  });

  it("finds the owner's own words as whole words, in any case", () => {
    expect(rules("Built for ACME Corp last year.", ["acme corp"])).toEqual(["banned-word"]);
    expect(rules("An acmecorporation logo.", ["acme"])).toEqual([]);
    expect(rules("Şirket: Örnek Ltd.", ["örnek ltd"])).toEqual(["banned-word"]);
  });

  it("never shows a whole secret", () => {
    const [finding] = findLeaks(fake("ghp_", "abcdefghijklmnopqrstuvwxyz0123456789"));
    expect(finding?.excerpt).toBe("ghp_abcd…");
  });

  it("checks what visitors could read, not the private note or the rendered copy", () => {
    const text = publishedText({
      quote: "Great work.",
      consentNote: "Agreed by email to ada@client-company.com",
      html: "<p>185.12.40.7</p>",
      tags: ["a", "b"],
    });
    expect(text).toBe("Great work.\na\nb");
  });

  it("sees through character references in the rendered text", async () => {
    // Markdown turns "&#64;" and "&#109;" into "@" and "m"; the rendered copy shows what visitors get.
    const post = {
      body: "Write to foo&#64;client.com, the team at Ac&#109;e.",
      html: '<p>Write to <a href="mailto:foo&#x40;client.com">foo&#x40;client.com</a>, the team at Acme.</p>',
    };
    expect(findLeaks(publishedText(post), ["Acme"])).toEqual([]);
    expect(findLeaks(checkedText(post), ["Acme"]).map((finding) => finding.rule)).toEqual([
      "email",
      "banned-word",
    ]);
  });

  it("stays fast on a long unbroken text", () => {
    const text = `${"A".repeat(60_000)}\n${"a".repeat(60_000)}\n${"1.".repeat(20_000)}`;
    const started = performance.now();
    findLeaks(text, ["Initech"]);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
