import "server-only";

// A sliding-window limit kept in this process's memory, for busy endpoints where a count lost on a restart
// doesn't matter (the visitor statistics) and a database round trip per request would. Remembers at most
// `maxKeys` keys; the ones used longest ago are dropped first.
export class MemoryLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  // Records an attempt at `at` (milliseconds) and says whether it is allowed. Blocked attempts are not
  // recorded, so they don't extend the wait.
  hit(key: string, at: number): boolean {
    const cutoff = at - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((time) => time > cutoff);
    const allowed = recent.length < this.limit;
    if (allowed) recent.push(at);
    // Deleted and set again, so the map stays in order of last use.
    this.hits.delete(key);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) {
      for (const oldest of this.hits.keys()) {
        this.hits.delete(oldest);
        if (this.hits.size <= this.maxKeys * 0.9) break;
      }
    }
    return allowed;
  }

  clear(): void {
    this.hits.clear();
  }
}

// A daily allowance kept in this process's memory: at most `limit` a day, then nothing until the next day.
// "just-full" is the first refusal of the day, for a single line in the log.
export class DailyCap {
  private day = "";
  private used = 0;
  private refused = 0;

  constructor(private readonly limit: number) {}

  take(day: string): "allowed" | "just-full" | "full" {
    if (day !== this.day) {
      this.day = day;
      this.used = 0;
      this.refused = 0;
    }
    if (this.used < this.limit) {
      this.used += 1;
      return "allowed";
    }
    this.refused += 1;
    return this.refused === 1 ? "just-full" : "full";
  }
}
