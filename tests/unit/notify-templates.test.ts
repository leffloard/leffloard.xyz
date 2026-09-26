import { describe, expect, it } from "vitest";
import { DeliveryError, postDiscord } from "@/server/notify/discord";
import { discordSafe, headerText, truncate } from "@/server/notify/escape";
import {
  defaultReplySubject,
  discordPayload,
  ownerAlertEmail,
  replyEmail,
  statusEmail,
  type DiscordEmbed,
} from "@/server/notify/templates";
import { callDoc, inquiryDoc, SITE_URL } from "../helpers/inquiry";

// Ported from the v1 backend's notification tests (tests/test_requests_api.py). See tests/legacy-parity.md.

const fieldsOf = (embed: DiscordEmbed) =>
  Object.fromEntries(embed.fields.map((field) => [field.name, field.value]));

describe("Discord alerts", () => {
  it("describe a call request, with the time in the reader's own zone", () => {
    const inquiry = callDoc();
    const payload = discordPayload(inquiry, SITE_URL);
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload).not.toHaveProperty("content");
    const [embed] = payload.embeds;
    expect(embed!.title).toBe("New call request");
    expect(embed!.url).toBe(`${SITE_URL}/admin/inbox/${inquiry._id.toHexString()}`);
    expect(embed!.description).toBe("Let's plan the new landing page.");
    expect(embed!.footer.text).toBe(inquiry.ref);
    const fields = fieldsOf(embed!);
    expect(fields.Name).toBe("Ada Lovelace");
    expect(fields.Email).toBe("ada@example.com");
    expect(fields.Contact).toBe("ada\\#0001");
    expect(fields.Service).toBe("Websites & web apps");
    expect(fields["Preferred time"]).toContain("2026-10-01 14:30 \\(Europe/Istanbul\\), 45 minutes");
    // 14:30 in Istanbul (UTC+3) is 11:30 UTC.
    expect(fields["Preferred time"]).toContain(`<t:${Date.UTC(2026, 9, 1, 11, 30) / 1000}:F>`);
    expect(fields.Subject).toBe("Kickoff call");
    expect(fields.Manage).toContain(`${SITE_URL}/admin/inbox/`);
  });

  it("have a title per kind, and escape the project name", () => {
    const revision = discordPayload(
      inquiryDoc({ kind: "revision", projectReference: "Order #1042 - Portfolio" }),
      SITE_URL,
    ).embeds[0]!;
    expect(revision.title).toBe("New revision request");
    expect(fieldsOf(revision).Project).toBe("Order \\#1042 - Portfolio");
    expect(fieldsOf(revision)).not.toHaveProperty("Preferred time");
    expect(discordPayload(inquiryDoc(), SITE_URL).embeds[0]!.title).toBe("New question");
    expect(
      discordPayload(inquiryDoc({ kind: "brief", budget: "500-1500" }), SITE_URL).embeds[0],
    ).toMatchObject({
      title: "New project brief",
    });
  });

  it("leave out the admin link without a site address", () => {
    const [embed] = discordPayload(inquiryDoc(), null).embeds;
    expect(embed).not.toHaveProperty("url");
    expect(fieldsOf(embed!)).not.toHaveProperty("Manage");
  });

  it("can't ping anyone or hide links", () => {
    const message =
      "@everyone @HERE look [click me](https://evil.example) <@123456> **bold** `code`\n# Heading\n> quote\n- item";
    const payload = discordPayload(
      inquiryDoc({ name: "@everyone", subject: "[x](https://evil.example)", message }),
      SITE_URL,
    );
    const dumped = JSON.stringify(payload);
    expect(dumped.toLowerCase()).not.toContain("@everyone");
    expect(dumped.toLowerCase()).not.toContain("@here");
    expect(dumped).not.toContain("](https://evil.example)");
    expect(dumped).not.toContain("<@123456>");
    const description = payload.embeds[0]!.description;
    expect(description).toContain("\\[click me\\]\\(https://evil.example\\)");
    expect(description).toContain("\\*\\*bold\\*\\*");
    expect(description).toContain("\\# Heading");
    expect(description).toContain("\\> quote");
    expect(description).toContain("\\- item");
  });

  it("stay inside Discord's size limits", () => {
    const payload = discordPayload(
      callDoc({
        message: "*_".repeat(2000),
        subject: "_".repeat(120),
        name: "*".repeat(80),
        company: "#".repeat(120),
        contact: "|".repeat(80),
        links: "[".repeat(1000),
        projectReference: "~".repeat(120),
        aiOptOut: true,
      }),
      SITE_URL,
    );
    const [embed] = payload.embeds;
    expect(embed!.description.length).toBeLessThanOrEqual(4096);
    for (const field of embed!.fields) {
      expect(field.value.length).toBeLessThanOrEqual(1024);
      expect(field.name.length).toBeLessThanOrEqual(256);
    }
    const total =
      embed!.title.length +
      embed!.description.length +
      embed!.footer.text.length +
      embed!.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
    expect(total).toBeLessThanOrEqual(6000);
    expect(embed!.fields.length).toBeLessThanOrEqual(25);
  });
});

describe("postDiscord", () => {
  it("fails on an error status, with Discord's answer but never the webhook address", async () => {
    const calls: unknown[] = [];
    const answers = [new Response(null, { status: 204 }), new Response("bad embed", { status: 400 })];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return answers.shift()!;
    }) as unknown as typeof fetch;
    const url = "https://discord.test/api/webhooks/42/SECRET-WEBHOOK-TOKEN";
    await postDiscord(url, { embeds: [] }, fakeFetch);
    const failure = await postDiscord(url, { embeds: [] }, fakeFetch).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DeliveryError);
    expect((failure as Error).message).toBe("Discord answered HTTP 400: bad embed");
    expect(calls).toEqual([{ embeds: [] }, { embeds: [] }]);
  });

  it("names a network failure without the webhook address", async () => {
    const refused = (async () => {
      throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
    }) as unknown as typeof fetch;
    const failure = (await postDiscord("https://discord.test/api/webhooks/42/SECRET", {}, refused).then(
      () => null,
      (error: unknown) => error,
    )) as Error;
    expect(failure.message).toBe("Discord could not be reached (ECONNREFUSED).");
    expect(failure.message).not.toContain("SECRET");
  });
});

describe("emails", () => {
  it("alert the owner with everything needed to answer", () => {
    const inquiry = callDoc();
    const email = ownerAlertEmail(inquiry, { to: "owner@leffloard.test", siteUrl: SITE_URL });
    expect(email.to).toEqual([{ address: "owner@leffloard.test" }]);
    expect(email.replyTo).toEqual({ name: "Ada Lovelace", address: "ada@example.com" });
    expect(email.subject).toBe("New call request from Ada Lovelace: Kickoff call");
    for (const line of [
      "Name: Ada Lovelace",
      "Email: ada@example.com",
      "Contact: ada#0001",
      "Service: Websites & web apps",
      "Preferred time: 2026-10-01 14:30 (Europe/Istanbul)",
      "In UTC: 2026-10-01 11:30 UTC",
      "Duration: 45 minutes",
      "Subject: Kickoff call",
      "Let's plan the new landing page.",
      `Reference: ${inquiry.ref}`,
      `${SITE_URL}/admin/inbox/${inquiry._id.toHexString()}`,
      "Reply to this email to answer Ada Lovelace directly.",
    ]) {
      expect(email.text).toContain(line);
    }
  });

  it("leave out the admin link without a site address", () => {
    expect(ownerAlertEmail(inquiryDoc(), { to: "o@x.example", siteUrl: null }).text).not.toContain("/admin");
  });

  it("mention a project name and the AI opt-out", () => {
    const text = ownerAlertEmail(
      inquiryDoc({ kind: "revision", projectReference: "Order #1042 - Portfolio", aiOptOut: true }),
      { to: "o@x.example", siteUrl: SITE_URL },
    ).text;
    expect(text).toContain("Project: Order #1042 - Portfolio");
    expect(text).toContain("AI tools: not allowed by the sender");
  });

  it("tell the visitor about a confirmed call, in their time zone", () => {
    const inquiry = callDoc({ status: "confirmed", scheduledAt: new Date("2026-10-01T11:30:00Z") });
    const email = statusEmail(inquiry, "confirmed", "See you on Google Meet.", {
      ownerEmail: "owner@leffloard.test",
      siteUrl: SITE_URL,
    });
    expect(email.to).toEqual([{ name: "Ada Lovelace", address: "ada@example.com" }]);
    expect(email.replyTo).toEqual({ address: "owner@leffloard.test" });
    expect(email.subject).toBe("Your call request: confirmed");
    expect(email.text).toContain('Your call request "Kickoff call" has been confirmed.');
    expect(email.text).toContain("Scheduled time: Thursday, 1 October 2026 at 14:30 (Europe/Istanbul)");
    expect(email.text).toContain("Duration: 45 minutes");
    expect(email.text).toContain("See you on Google Meet.");
    expect(email.text).toContain(SITE_URL);
  });

  it("mention the scheduled time only when confirming", () => {
    const inquiry = callDoc({ scheduledAt: new Date("2026-10-01T11:30:00Z") });
    for (const status of ["declined", "done", "new", "open"] as const) {
      expect(statusEmail(inquiry, status, null, { ownerEmail: null, siteUrl: SITE_URL }).text).not.toContain(
        "Scheduled time",
      );
    }
    expect(statusEmail(inquiry, "done", null, { ownerEmail: null, siteUrl: SITE_URL }).subject).toBe(
      "Your call request: completed",
    );
  });

  it("name other kinds in the status email", () => {
    const email = statusEmail(inquiryDoc({ kind: "revision" }), "declined", null, {
      ownerEmail: null,
      siteUrl: null,
    });
    expect(email.subject).toBe("Your revision request: declined");
    expect(email.replyTo).toBeUndefined();
  });

  it("quote the visitor's message under a reply", () => {
    const inquiry = inquiryDoc({ message: "First line\n\nSecond line" });
    const email = replyEmail(
      inquiry,
      { subject: "Re: pricing", body: "Hi Alan,\nAbout $480." },
      {
        ownerEmail: "owner@leffloard.test",
        siteUrl: SITE_URL,
      },
    );
    expect(email.text).toBe(
      [
        "Hi Alan,",
        "About $480.",
        "",
        "-- ",
        "Mert Kaan Koparan",
        SITE_URL,
        "",
        "On 26 September 2026, Alan Turing wrote:",
        "> First line",
        ">",
        "> Second line",
        "",
      ].join("\n"),
    );
    expect(defaultReplySubject(inquiry)).toBe("Re: Discord bot pricing");
    expect(defaultReplySubject(inquiryDoc({ subject: "RE: again" }))).toBe("RE: again");
  });
});

describe("escaping helpers", () => {
  it("truncate at code points and mark the cut", () => {
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("😀😀😀", 2)).toBe("😀…");
  });

  it("keep header text on one line and neutralise encoded words", () => {
    expect(headerText("  Ann\u2028Lee \r\n Quote\t ")).toBe("Ann Lee Quote");
    expect(headerText("=?utf-8?q?A=0AB?= plan")).toBe("= ?utf-8?q?A=0AB?= plan");
    expect(headerText("a =? b")).toBe("a =? b");
  });

  it("escape Markdown and mentions for Discord", () => {
    expect(discordSafe("@here *hi*")).toBe("@\u200bhere \\*hi\\*");
    expect(discordSafe("x".repeat(2000)).length).toBe(1024);
  });
});
