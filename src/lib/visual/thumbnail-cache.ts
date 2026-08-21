/** Bounded thumbnail LRU + neighbor preload so timeline scrubbing does not hitch. */

export const THUMB_CACHE_MAX = 96;
export const NEIGHBOR_RADIUS = 8;

export function neighborIds(
  frames: { id: string; frameNumber: number }[],
  current: number,
  radius = 3,
): string[] {
  if (frames.length === 0) return [];
  const idx = indexOfFrame(frames, current);
  if (idx >= 0) {
    const out: string[] = [];
    const lo = Math.max(0, idx - radius);
    const hi = Math.min(frames.length - 1, idx + radius);
    for (let i = lo; i <= hi; i += 1) out.push(frames[i]!.id);
    return out;
  }
  const byNum = new Map(frames.map((f) => [f.frameNumber, f.id]));
  const out: string[] = [];
  for (let i = current - radius; i <= current + radius; i += 1) {
    const id = byNum.get(i);
    if (id) out.push(id);
  }
  return out;
}

function indexOfFrame(frames: { frameNumber: number }[], current: number): number {
  let lo = 0;
  let hi = frames.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const n = frames[mid]!.frameNumber;
    if (n === current) return mid;
    if (n < current) lo = mid + 1;
    else hi = mid - 1;
  }
  if (frames[current] && frames[current]!.frameNumber === current) return current;
  return -1;
}

export function sampleStripIndices(count: number, samples = 6): number[] {
  if (count <= 0) return [];
  if (count <= samples) return Array.from({ length: count }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    out.push(Math.round((i / (samples - 1)) * (count - 1)));
  }
  return [...new Set(out)];
}

export type ThumbLoader = (src: string) => void;

export class ThumbnailCache {
  readonly max: number;
  hits = 0;
  misses = 0;
  evictions = 0;
  private items = new Map<string, string>();
  private load?: ThumbLoader;

  constructor(max = THUMB_CACHE_MAX, load?: ThumbLoader) {
    this.max = Math.max(8, max);
    this.load = load;
  }

  get size(): number {
    return this.items.size;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  get(id: string): string | undefined {
    const src = this.items.get(id);
    if (src === undefined) {
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    this.items.delete(id);
    this.items.set(id, src);
    return src;
  }

  set(id: string, src: string): string {
    if (!src) return src;
    if (this.items.has(id)) this.items.delete(id);
    this.items.set(id, src);
    while (this.items.size > this.max) {
      const oldest = this.items.keys().next().value;
      if (oldest === undefined) break;
      this.items.delete(oldest);
      this.evictions += 1;
    }
    this.load?.(src);
    return src;
  }

  remember(id: string, src: string): string {
    return this.get(id) ?? this.set(id, src);
  }

  preload(ids: string[], resolve: (id: string) => string | undefined | null): string[] {
    const warmed: string[] = [];
    for (const id of ids) {
      const cached = this.get(id);
      if (cached) {
        warmed.push(id);
        continue;
      }
      const src = resolve(id);
      if (!src) continue;
      this.set(id, src);
      warmed.push(id);
    }
    return warmed;
  }

  preloadNeighbors(
    frames: { id: string; frameNumber: number }[],
    current: number,
    resolve: (id: string) => string | undefined | null,
    radius = NEIGHBOR_RADIUS,
  ): string[] {
    return this.preload(neighborIds(frames, current, radius), resolve);
  }

  clear(): void {
    this.items.clear();
  }
}

export function createBrowserThumbLoader(): ThumbLoader | undefined {
  if (typeof Image === "undefined") return undefined;
  const inflight = new Set<string>();
  return (src: string) => {
    if (!src || inflight.has(src)) return;
    inflight.add(src);
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    img.onload = () => inflight.delete(src);
    img.onerror = () => inflight.delete(src);
  };
}
