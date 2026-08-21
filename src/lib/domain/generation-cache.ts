/** In-memory generation cache. Different curve / seed / constraint → miss. */

type Entry = { at: number; value: unknown };
const STORE = new Map<string, Entry>();
const TTL_MS = 10 * 60 * 1000;

export function generationCacheKey(input: {
  startHash: string;
  endHash: string;
  provider: string;
  modelVersion: string;
  seed?: number | null;
  motionPlanHash: string;
  constraintHash: string;
  resolution: string;
  frameCount: number;
}): string {
  return [
    input.startHash,
    input.endHash,
    input.provider,
    input.modelVersion,
    String(input.seed ?? ""),
    input.motionPlanHash,
    input.constraintHash,
    input.resolution,
    String(input.frameCount),
  ].join("|");
}

export function generationCacheGet<T>(key: string): T | null {
  const hit = STORE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    STORE.delete(key);
    return null;
  }
  return hit.value as T;
}

export function generationCacheSet(key: string, value: unknown): void {
  STORE.set(key, { at: Date.now(), value });
}
