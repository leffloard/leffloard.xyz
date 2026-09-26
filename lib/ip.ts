import { isIP } from "node:net";

/**
 * Normalises an address for rate limiting. IPv6 addresses are grouped by /64, because one host usually
 * controls a whole /64; IPv4-mapped IPv6 addresses count as IPv4. Returns null for anything that is not
 * an IP address. (Ported from the v1 backend's security.py.)
 */
export function ipKey(raw: string): string | null {
  let value = raw.trim();
  if (value.startsWith("[") && value.includes("]")) value = value.slice(1, value.indexOf("]"));
  else if (value.split(":").length === 2) value = value.slice(0, value.indexOf(":"));
  value = value.replace(/%.*$/, ""); // zone id (fe80::1%eth0)

  const version = isIP(value);
  if (version === 4) return value;
  if (version !== 6) return null;

  const groups = expandIpv6(value);
  const mapped = mappedIpv4(groups);
  if (mapped) return mapped;
  const prefix = groups.slice(0, 4).map((group) => parseInt(group, 16).toString(16));
  return `${compressIpv6([...prefix, "0", "0", "0", "0"])}/64`;
}

function expandIpv6(address: string): string[] {
  let text = address.toLowerCase();
  // A trailing embedded IPv4 part (::ffff:1.2.3.4) becomes two hex groups.
  const ipv4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (ipv4) {
    const [a, b, c, d] = ipv4.slice(1).map(Number) as [number, number, number, number];
    text = text.slice(0, ipv4.index) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", tail] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = tail === undefined ? [] : tail ? tail.split(":") : [];
  const missing = 8 - left.length - right.length;
  const groups = tail === undefined ? left : [...left, ...Array<string>(missing).fill("0"), ...right];
  return groups.map((group) => group.padStart(4, "0"));
}

function mappedIpv4(groups: string[]): string | null {
  const isMapped = groups.slice(0, 5).every((group) => group === "0000") && groups[5] === "ffff";
  if (!isMapped) return null;
  const high = parseInt(groups[6] ?? "0", 16);
  const low = parseInt(groups[7] ?? "0", 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

// Standard short form: the longest run of zero groups (two or more) becomes "::".
function compressIpv6(groups: string[]): string {
  let bestStart = -1;
  let bestLength = 0;
  for (let start = 0; start < groups.length;) {
    if (groups[start] !== "0") {
      start++;
      continue;
    }
    let end = start;
    while (end < groups.length && groups[end] === "0") end++;
    if (end - start > bestLength) {
      bestStart = start;
      bestLength = end - start;
    }
    start = end;
  }
  if (bestLength < 2) return groups.join(":");
  const left = groups.slice(0, bestStart).join(":");
  const right = groups.slice(bestStart + bestLength).join(":");
  return `${left}::${right}`;
}

export type ClientIpSource = "socket" | "cloudflare";

/**
 * The visitor's address from the request headers.
 * - "cloudflare": CF-Connecting-IP, set by Cloudflare's edge (the app only listens on 127.0.0.1 behind the
 *   tunnel, so nobody else can reach it and set the header).
 * - "socket": the last X-Forwarded-For entry, which Next.js fills with the connecting address when the
 *   header is missing. Only trustworthy when nothing but the site's own proxy can reach the app.
 */
export function clientIp(headers: Headers, source: ClientIpSource): string {
  if (source === "cloudflare") {
    const cloudflare = headers.get("cf-connecting-ip");
    if (cloudflare && ipKey(cloudflare)) return cloudflare.trim();
  }
  const forwarded = headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return forwarded && ipKey(forwarded) ? forwarded : "unknown";
}
