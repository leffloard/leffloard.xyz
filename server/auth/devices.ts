import "server-only";
import { userAgentFromString } from "next/server";

// "Chrome on Windows", "Mobile Safari on iOS": enough to recognise a device in a list.
export function describeDevice(userAgent: string): string {
  if (!userAgent) return "Unknown device";
  if (!userAgent.startsWith("Mozilla/")) return userAgent.slice(0, 40); // "npm run admin" and other tools
  const { browser, os } = userAgentFromString(userAgent);
  return `${browser.name ?? "Browser"} on ${os.name ?? "an unknown system"}`;
}
