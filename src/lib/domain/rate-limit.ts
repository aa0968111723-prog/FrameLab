import { fail } from "./errors.ts";

const WINDOW_MS = 60_000;
const DEFAULT_MAX = 120;
const SWEEP_EVERY_MS = 30_000;

const buckets = new Map<string, number[]>();
let lastSweep = 0;

function sweepExpired(now: number): void {
  if (now - lastSweep < SWEEP_EVERY_MS && buckets.size < 256) return;
  lastSweep = now;
  for (const [key, times] of buckets) {
    const kept = times.filter((t) => now - t < WINDOW_MS);
    if (kept.length === 0) buckets.delete(key);
    else buckets.set(key, kept);
  }
}

export function checkRateLimit(
  key: string,
  maxPerMinute: number = DEFAULT_MAX,
  now = Date.now(),
): { remaining: number } {
  sweepExpired(now);
  const prev = buckets.get(key) ?? [];
  const times = prev.filter((t) => now - t < WINDOW_MS);
  if (times.length === 0 && prev.length > 0) buckets.delete(key);
  if (times.length >= maxPerMinute) {
    buckets.set(key, times);
    fail("RATE_LIMITED", `Rate limit exceeded (${maxPerMinute}/min)`, 429);
  }
  times.push(now);
  buckets.set(key, times);
  return { remaining: maxPerMinute - times.length };
}

export function resetRateLimitForTests(): void {
  buckets.clear();
  lastSweep = 0;
}

export function rateLimitBucketCountForTests(): number {
  return buckets.size;
}
