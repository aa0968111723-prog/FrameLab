/** Deterministic analysis cache key. Same inputs must not re-run GPU work. */

export function analysisCacheKey(input: {
  analysisType: string;
  provider: string;
  modelVersion?: string;
  frameHashes: string[];
  start: number;
  end: number;
  regionHash?: string;
  configHash?: string;
}): string {
  return [
    input.analysisType,
    input.provider,
    input.modelVersion ?? "0.2",
    String(input.start),
    String(input.end),
    input.regionHash ?? "full",
    input.configHash ?? "default",
    input.frameHashes.join(","),
  ].join("|");
}

const mem = new Map<string, { at: number; value: unknown }>();
const TTL_MS = 10 * 60 * 1000;

export function cacheGet<T>(key: string): T | null {
  const hit = mem.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    mem.delete(key);
    return null;
  }
  return hit.value as T;
}

export function cacheSet(key: string, value: unknown) {
  mem.set(key, { at: Date.now(), value });
}
