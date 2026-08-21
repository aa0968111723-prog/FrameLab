import { fail } from "./errors";

type Bucket = { times: number[] };

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 60_000;
const DEFAULT_MAX = 120;

export function checkRateLimit(
  key: string,
  maxPerMinute: number = DEFAULT_MAX,
  now = Date.now(),
): { remaining: number } {
  let b = buckets.get(key);
  if (!b) {
    b = { times: [] };
    buckets.set(key, b);
  }
  b.times = b.times.filter((t) => now - t < WINDOW_MS);
  if (b.times.length >= maxPerMinute) {
    fail("PERMISSION_DENIED", `Rate limit exceeded (${maxPerMinute}/min)`);
  }
  b.times.push(now);
  return { remaining: maxPerMinute - b.times.length };
}

export function resetRateLimitForTests(): void {
  buckets.clear();
}
