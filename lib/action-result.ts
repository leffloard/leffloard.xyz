// What server actions return to the browser. Shared by the server wrapper and client components.
export type ActionErrorCode = "unauthorized" | "sudo_required" | "invalid" | "rate_limited" | "failed";

export type ActionResult<T = null> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; code: ActionErrorCode; fieldErrors?: Record<string, string> };

export function ok<T>(data: T, message?: string): ActionResult<T> {
  return message === undefined ? { ok: true, data } : { ok: true, data, message };
}

export function fail(error: string, code: ActionErrorCode = "failed"): ActionResult<never> {
  return { ok: false, error, code };
}

export function waitMessage(seconds: number): string {
  if (seconds < 90) return `Too many attempts. Try again in ${seconds} seconds.`;
  return `Too many attempts. Try again in ${Math.ceil(seconds / 60)} minutes.`;
}
