import { describe, expect, it } from "vitest";
import { formatBytes, plural } from "@/lib/format";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [14_540, "14.2 KB"],
    [3 * 1024 * 1024 + 100_000, "3.1 MB"],
    [512 * 1024 * 1024, "512 MB"],
    [5 * 1024 ** 4, "5.0 TB"],
  ])("writes %i bytes as %s", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

describe("plural", () => {
  it("uses the singular for one", () => {
    expect(plural(1, "message")).toBe("1 message");
    expect(plural(2, "message")).toBe("2 messages");
    expect(plural(0, "reply", "replies")).toBe("0 replies");
  });
});
