import "server-only";
import { createHash } from "node:crypto";
import { createTransport, type Transporter } from "nodemailer";
import { log } from "@/server/log";
import type { EmailConfig } from "@/server/notify/channels";
import type { EmailMessage, Mailbox } from "@/server/notify/templates";

// Sends one email over SMTP (or writes it to the log with EMAIL_DELIVERY=log). Nodemailer encodes
// non-ASCII names and subjects (RFC 2047) and folds long headers; header text is already on one line.

export type MailSender = (message: EmailMessage, config: EmailConfig) => Promise<void>;

type SmtpConfig = Extract<EmailConfig, { delivery: "smtp" }>;

let cached: { key: string; transport: Transporter } | undefined;

function transportFor(config: SmtpConfig): Transporter {
  const key = createHash("sha256")
    .update(JSON.stringify([config.host, config.port, config.security, config.username, config.password]))
    .digest("hex");
  if (cached?.key !== key) {
    cached?.transport.close();
    cached = {
      key,
      transport: createTransport({
        host: config.host,
        port: config.port,
        secure: config.security === "ssl",
        requireTLS: config.security === "starttls",
        ignoreTLS: config.security === "none",
        auth: config.username ? { user: config.username, pass: config.password ?? "" } : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      }),
    };
  }
  return cached.transport;
}

function address(mailbox: Mailbox): string | { name: string; address: string } {
  return mailbox.name ? { name: mailbox.name, address: mailbox.address } : mailbox.address;
}

export const sendEmail: MailSender = async (message, config) => {
  if (config.delivery === "log") {
    log.info(
      { to: message.to.map((mailbox) => mailbox.address), subject: message.subject, text: message.text },
      "email written to the log instead of being sent (EMAIL_DELIVERY=log)",
    );
    return;
  }
  await transportFor(config).sendMail({
    from: config.from,
    to: message.to.map(address),
    replyTo: message.replyTo ? address(message.replyTo) : undefined,
    subject: message.subject,
    text: message.text,
    // Sent as a text/calendar part and as an attachment, which calendar-aware mail apps turn into an invite.
    icalEvent: message.calendar
      ? { method: message.calendar.method, filename: "invite.ics", content: message.calendar.content }
      : undefined,
  });
};
