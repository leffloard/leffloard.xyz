import "server-only";

// Posts to a Discord webhook. The webhook address contains its secret token, so no error message, log
// line or stored error ever includes it.

export type DiscordPoster = (url: string, payload: unknown) => Promise<void>;

export class DeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryError";
  }
}

function networkReason(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") return "timed out";
  const cause = error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  return typeof cause?.code === "string" ? cause.code : "network error";
}

export async function postDiscord(
  url: string,
  payload: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new DeliveryError(`Discord could not be reached (${networkReason(error)}).`);
  }
  if (response.status >= 300) {
    const text = (await response.text().catch(() => "")).slice(0, 300);
    throw new DeliveryError(`Discord answered HTTP ${response.status}${text ? `: ${text}` : "."}`);
  }
}
