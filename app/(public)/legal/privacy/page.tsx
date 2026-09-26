import type { Metadata } from "next";
import { LegalPage } from "@/components/site/legal";
import { site } from "@/content/site";

export const metadata: Metadata = {
  title: "Privacy notice",
  description:
    "What personal data this site collects, why, where it is processed, and your rights under KVKK and the GDPR.",
  alternates: { canonical: "/legal/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy notice" updated="26 September 2026">
      <p>
        This notice explains what personal data leffloard.xyz collects, why, and what you can ask me to do
        with it. It is written to meet the Turkish Personal Data Protection Law (KVKK, No. 6698) and the EU
        General Data Protection Regulation (GDPR).
      </p>
      <h2>Who is responsible</h2>
      <p>
        The data controller is {site.name}, an independent software developer in {site.location}. Contact:{" "}
        <a href={`mailto:${site.email}`}>{site.email}</a>.
      </p>
      <h2>What I collect</h2>
      <ul>
        <li>
          <strong>Messages you send me</strong> by email or through the site: your name, email address, and
          whatever you write about your project.
        </li>
        <li>
          <strong>Call bookings</strong>: your name, email address and time zone, the time you chose, and your
          answers to the booking&apos;s questions.
        </li>
        <li>
          <strong>Client records</strong> once we work together: your contact details, notes on our calls,
          emails and meetings, the project&apos;s tasks, revision requests and the time spent on it, and
          quotes, invoices and payments.
        </li>
        <li>
          <strong>Quotes and invoices</strong>: the name, company, email and address they are made out to,
          what they are for, and whether and when their link was opened.
        </li>
        <li>
          <strong>Payments</strong>: for a bank transfer, the amount, the day it arrived and its reference
          (which may show the sender&apos;s name); for cryptocurrency, NOWPayments&apos; payment number, the
          coin and the amount paid. I never see card details, wallet keys or bank logins.
        </li>
        <li>
          <strong>Technical data</strong> needed to run the site securely: IP address, browser type and the
          time of a request, used for rate limits, abuse prevention and security logs.
        </li>
      </ul>
      <p>
        There are no advertising or tracking cookies. The only cookies are the ones that keep you signed in to
        the admin or the client portal.
      </p>
      <h2>Why, and on what legal basis</h2>
      <ul>
        <li>To answer your inquiry and prepare a quote: steps before a contract, at your request.</li>
        <li>
          To hold a call you booked, and send you its invite, changes and a reminder: steps before a contract,
          or the contract itself, at your request.
        </li>
        <li>
          To deliver and invoice a project, confirm payments and remind you of an unpaid invoice: performance
          of a contract, and legal obligations for accounting.
        </li>
        <li>To keep the site secure: my legitimate interest in preventing abuse.</li>
      </ul>
      <h2>Who processes it for me</h2>
      <p>These services process data on my behalf. Some of them store or process data outside Turkey.</p>
      <ul>
        <li>MongoDB Atlas: the database that stores inquiries and client records.</li>
        <li>
          Google (Gmail, Google Calendar): email, and my own calendar, which shows the calls booked with me.
        </li>
        <li>Discord: private notifications to me about new messages and bookings.</li>
        <li>
          Jitsi Meet (meet.jit.si, run by 8x8): our video calls. The room&apos;s link is made on this site and
          nothing from your booking is sent to Jitsi, but it carries the call itself.
        </li>
        <li>
          Anthropic (Claude): only when I use an AI assistant to sort messages or draft replies, and never for
          a message whose sender ticked &ldquo;Don&apos;t use AI tools on my message&rdquo;.
        </li>
        <li>Cloudflare: network, security and bot checks (Turnstile) for the site.</li>
        <li>
          NOWPayments: only if you choose to pay with cryptocurrency. It receives the invoice&apos;s number,
          description and amount, and you pay on its page, under its own privacy policy.
        </li>
      </ul>
      <h2>How long I keep it</h2>
      <p>
        Inquiries that do not become a project are deleted after 24 months without contact, and messages
        marked as spam after 30 days. Call bookings are deleted 24 months after the call. Copies of the emails
        the site sends are kept for 30 days to check they arrived. Client records, quotes, invoices and
        payments are kept for as long as Turkish tax and commercial law requires (up to 10 years). The payment
        provider&apos;s notifications about a payment are kept for about 13 months. Security logs are kept for
        up to 12 months.
      </p>
      <h2>Your rights</h2>
      <p>
        You can ask whether I process your data, get a copy of it, have it corrected or deleted, object to its
        processing, and ask where it was transferred. Under KVKK Article 11 and the GDPR you may also complain
        to the Turkish Personal Data Protection Authority or your local EU data protection authority. To use
        any of these rights, email <a href={`mailto:${site.email}`}>{site.email}</a>. I answer within 30 days.
      </p>
      <h2>Changes</h2>
      <p>
        When I add a new service that processes your data, it is listed here first, with a new date above.
      </p>
    </LegalPage>
  );
}
