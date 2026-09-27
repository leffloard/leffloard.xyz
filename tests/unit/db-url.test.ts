import { describe, expect, it } from "vitest";
import { mongoHosts, redactMongoUrl } from "@/server/db/url";

describe("redactMongoUrl", () => {
  it("hides the password and keeps the rest", () => {
    expect(redactMongoUrl("mongodb+srv://leff:p%40ss@cluster0.ab12.mongodb.net/?appName=leff")).toBe(
      "mongodb+srv://leff:***@cluster0.ab12.mongodb.net/?appName=leff",
    );
    expect(redactMongoUrl("mongodb://127.0.0.1:27027/?replicaSet=rs0")).toBe(
      "mongodb://127.0.0.1:27027/?replicaSet=rs0",
    );
  });

  it("over-redacts malformed strings instead of leaking part of a password", () => {
    const redacted = redactMongoUrl("mongodb+srv://leff:pa/ss@wo@rd@cluster0.mongodb.net");
    expect(redacted).toBe("mongodb+srv://leff:***@cluster0.mongodb.net");
    expect(redactMongoUrl("mongodb://:secret@host")).toBe("mongodb://***@host");
  });
});

describe("mongoHosts", () => {
  it("returns only the hosts", () => {
    expect(mongoHosts("mongodb+srv://leff:secret@cluster0.ab12.mongodb.net/db?appName=leff")).toBe(
      "cluster0.ab12.mongodb.net",
    );
    expect(mongoHosts("mongodb://a:1,b:2/?replicaSet=rs0")).toBe("a:1,b:2");
  });
});
