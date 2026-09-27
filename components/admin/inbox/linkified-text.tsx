import { Fragment } from "react";

const URL_PATTERN = /(https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]])/g;

// Visitor text with its http(s) addresses clickable. Everything else stays plain text (React escapes it);
// links open in a new tab without a referrer.
export function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(URL_PATTERN);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="break-all text-accent underline underline-offset-2"
          >
            {part}
          </a>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
