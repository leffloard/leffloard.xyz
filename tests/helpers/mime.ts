// Just enough MIME parsing for tests: read a raw email's headers (unfolded, RFC 2047 words decoded) and its
// text body, the way a mail client would show them.

export type ParsedEmail = { headers: Map<string, string>; rawHeaders: string; body: string };

function decodeWord(charset: string, encoding: string, text: string): Buffer {
  if (encoding.toUpperCase() === "B") return Buffer.from(text, "base64");
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === "_") bytes.push(0x20);
    else if (char === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(text.slice(index + 1, index + 3), 16));
      index += 2;
    } else bytes.push(char.charCodeAt(0));
  }
  void charset;
  return Buffer.from(bytes);
}

// Adjacent encoded words are joined before decoding, so a character split across two words survives.
export function decodeHeader(value: string): string {
  const word = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/y;
  let output = "";
  let pending: Buffer[] = [];
  const flush = () => {
    if (pending.length) output += Buffer.concat(pending).toString("utf8");
    pending = [];
  };
  let index = 0;
  while (index < value.length) {
    word.lastIndex = index;
    const match = word.exec(value);
    if (match) {
      pending.push(decodeWord(match[1]!, match[2]!, match[3]!));
      index = word.lastIndex;
      // Whitespace between two encoded words is not part of the text.
      const gap = /^[ \t]+(?==\?)/.exec(value.slice(index));
      if (gap) index += gap[0].length;
      continue;
    }
    flush();
    output += value[index];
    index++;
  }
  flush();
  return output;
}

function decodeQuotedPrintable(text: string): Buffer {
  const joined = text.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let index = 0; index < joined.length; index++) {
    const char = joined[index]!;
    if (char === "=" && /^[0-9A-Fa-f]{2}$/.test(joined.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(joined.slice(index + 1, index + 3), 16));
      index += 2;
    } else bytes.push(char.charCodeAt(0));
  }
  return Buffer.from(bytes);
}

export function parseEmail(raw: string | Buffer): ParsedEmail {
  const text = Buffer.isBuffer(raw) ? raw.toString("latin1") : raw;
  const split = text.indexOf("\r\n\r\n");
  const rawHeaders = text.slice(0, split);
  const headers = new Map<string, string>();
  for (const line of rawHeaders.replace(/\r\n[ \t]+/g, (fold) => fold.slice(2)).split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon > 0)
      headers.set(line.slice(0, colon).toLowerCase(), decodeHeader(line.slice(colon + 1).trim()));
  }
  const encoding = (headers.get("content-transfer-encoding") ?? "7bit").toLowerCase();
  const rawBody = text.slice(split + 4);
  const bytes =
    encoding === "base64"
      ? Buffer.from(rawBody.replace(/\s+/g, ""), "base64")
      : encoding === "quoted-printable"
        ? decodeQuotedPrintable(rawBody)
        : Buffer.from(rawBody, "latin1");
  return { headers, rawHeaders, body: bytes.toString("utf8").replace(/\r\n/g, "\n") };
}
