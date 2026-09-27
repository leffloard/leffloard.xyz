import { describe, expect, it } from "vitest";
import { formatBytes, formatDate, formatDateTime, formatTime, plural } from "@/lib/format";

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

describe("admin dates", () => {
  it("shows the owner's time zone with short month names spelled out", () => {
    // 21:05 UTC is already the next day in Istanbul.
    const late = new Date("2026-09-26T21:05:00Z");
    expect(formatDateTime(late)).toBe("27 Sep 2026, 00:05");
    expect(formatDate(late)).toBe("27 Sep 2026");
    expect(formatTime(late)).toBe("00:05");
    expect(formatDateTime(new Date("2027-01-05T08:00:00Z"))).toBe("5 Jan 2027, 11:00");
  });
});
