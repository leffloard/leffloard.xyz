import type * as Nodemailer from "nodemailer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailConfig } from "@/server/notify/channels";
import { sendEmail } from "@/server/notify/email";
import { ownerAlertEmail, statusEmail } from "@/server/notify/templates";
import { inquiryDoc, SITE_URL } from "../helpers/inquiry";
import { parseEmail } from "../helpers/mime";

// Ported from the v1 backend's email tests: SMTP security modes, non-ASCII text and header safety. The
// SMTP connection is replaced by nodemailer's stream transport, so the exact bytes a server would receive
// can be read back.

const transports: Record<string, unknown>[] = [];
const raws: Buffer[] = [];

vi.mock("nodemailer", async (importOriginal) => {
  const actual = await importOriginal<typeof Nodemailer>();
  const stream = actual.createTransport({ streamTransport: true, buffer: true, newline: "windows" });
  return {
    ...actual,
    createTransport: vi.fn((options: Record<string, unknown>) => {
      transports.push(options);
      return {
        close: vi.fn(),
        sendMail: async (mail: Nodemailer.SendMailOptions) => {
          const info = await stream.sendMail(mail);
          raws.push(info.message as Buffer);
          return info;
        },
      };
    }),
  };
});

const smtp = (overrides: Partial<Extract<EmailConfig, { delivery: "smtp" }>> = {}): EmailConfig => ({
  delivery: "smtp",
  from: "leffloard.xyz <mailer@leffloard.test>",
  host: "smtp.leffloard.test",
  port: 2525,
  security: "starttls",
  username: "mailer@leffloard.test",
  password: "app-password",
  ...overrides,
});

const plainMessage = { to: [{ address: "x@example.com" }], subject: "Hi", text: "Hello\n" };

beforeEach(() => {
  transports.length = 0;
  raws.length = 0;
});

describe("sendEmail", () => {
  it.each([
    [
      "starttls",
      "mailer",
      { secure: false, requireTLS: true, ignoreTLS: false, auth: { user: "mailer", pass: "secret" } },
    ],
    [
      "ssl",
      "mailer",
      { secure: true, requireTLS: false, ignoreTLS: false, auth: { user: "mailer", pass: "secret" } },
    ],
    ["none", undefined, { secure: false, requireTLS: false, ignoreTLS: true, auth: undefined }],
  ] as const)("connects with %s security", async (security, username, expected) => {
    await sendEmail(
      plainMessage,
      smtp({ security, username, password: "secret", host: `smtp-${security}.test` }),
    );
    expect(transports.at(-1)).toMatchObject({ host: `smtp-${security}.test`, port: 2525, ...expected });
  });

  it("reuses the connection pool while the settings stay the same", async () => {
    const config = smtp({ host: "smtp-reuse.test" });
    await sendEmail(plainMessage, config);
    await sendEmail(plainMessage, config);
    expect(transports).toHaveLength(1);
  });

  it("only writes to the log with EMAIL_DELIVERY=log", async () => {
    await sendEmail(plainMessage, { delivery: "log", from: "noreply@leffloard.test" });
    expect(transports).toHaveLength(0);
    expect(raws).toHaveLength(0);
  });

  it("encodes non-ASCII names, subjects and text so they read back unchanged", async () => {
    const inquiry = inquiryDoc({
      name: "Şükrü Öztürk",
      email: "sukru@example.com",
      subject: "Görüşme",
      message: "Merhaba, çalışma saatleriniz nedir?",
      status: "confirmed",
    });
    await sendEmail(ownerAlertEmail(inquiry, { to: "owner@leffloard.test", siteUrl: SITE_URL }), smtp());
    await sendEmail(
      statusEmail(inquiry, "confirmed", "Teşekkürler", {
        ownerEmail: "owner@leffloard.test",
        siteUrl: SITE_URL,
      }),
      smtp(),
    );
    const [owner, visitor] = raws.map((raw) => parseEmail(raw));
    expect(owner!.headers.get("subject")).toBe("New question from Şükrü Öztürk: Görüşme");
    expect(owner!.headers.get("reply-to")).toBe("Şükrü Öztürk <sukru@example.com>");
    expect(owner!.body).toContain("Merhaba, çalışma saatleriniz nedir?");
    expect(visitor!.headers.get("to")).toBe("Şükrü Öztürk <sukru@example.com>");
    expect(visitor!.headers.get("reply-to")).toBe("owner@leffloard.test");
    expect(visitor!.body).toContain("Teşekkürler");
  });

  it("keeps a long non-ASCII subject intact through header folding", async () => {
    const subject = (
      "Bot için görüşme ve çok uzun bir konu satırı " + "Bot için görüşme ve çok uzun bir konu satırı"
    ).trim();
    await sendEmail(
      ownerAlertEmail(inquiryDoc({ name: "Şükrü Öztürk", subject }), {
        to: "o@leffloard.test",
        siteUrl: null,
      }),
      smtp(),
    );
    expect(parseEmail(raws[0]!).headers.get("subject")).toBe(`New question from Şükrü Öztürk: ${subject}`);
  });

  it.each([
    ["Ann\u2028Lee", "Quote\u2029for site"],
    ["=?utf-8?q?A=0AB?=", "=?utf-8?b?QQpC?= plan"],
  ])("can't be tricked into extra header lines by %j", async (name, subject) => {
    const inquiry = inquiryDoc({ name, subject, email: "alan@example.com" });
    await sendEmail(ownerAlertEmail(inquiry, { to: "owner@leffloard.test", siteUrl: SITE_URL }), smtp());
    await sendEmail(statusEmail(inquiry, "confirmed", null, { ownerEmail: null, siteUrl: SITE_URL }), smtp());
    const [owner, visitor] = raws.map((raw) => parseEmail(raw));
    expect(owner!.headers.get("subject")).not.toMatch(/[\r\n]/);
    expect(owner!.headers.get("subject")).not.toContain("A\nB");
    expect(owner!.headers.get("reply-to")).toMatch(/<alan@example\.com>$/);
    expect(visitor!.headers.get("to")).toMatch(/<alan@example\.com>$/);
    // No header line other than the ones nodemailer writes.
    const names = owner!.rawHeaders
      .replace(/\r\n[ \t]+/g, " ")
      .split("\r\n")
      .map((line) => line.slice(0, line.indexOf(":")).toLowerCase());
    expect(
      names.every((header) =>
        /^(content-type|from|to|reply-to|subject|message-id|content-transfer-encoding|date|mime-version)$/.test(
          header,
        ),
      ),
    ).toBe(true);
  });
});
