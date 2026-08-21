import type { RgbaFrame } from "./pixel-metrics.ts";
import type { TrackStatus } from "./types.ts";

export type TrackedPoint = {
  frameIndex: number;
  x: number;
  y: number;
  score: number;
  status: TrackStatus;
};

export type NccTrackOptions = {
  patch?: number;
  search?: number;
  minScore?: number;
};

function luma(frame: RgbaFrame, x: number, y: number): number {
  const xi = Math.max(0, Math.min(frame.width - 1, Math.round(x)));
  const yi = Math.max(0, Math.min(frame.height - 1, Math.round(y)));
  const i = (yi * frame.width + xi) * 4;
  return 0.2126 * frame.data[i] + 0.7152 * frame.data[i + 1] + 0.0722 * frame.data[i + 2];
}

function extractPatch(frame: RgbaFrame, cx: number, cy: number, patch: number): Float64Array {
  const half = (patch - 1) / 2;
  const out = new Float64Array(patch * patch);
  let k = 0;
  for (let j = 0; j < patch; j += 1) {
    for (let i = 0; i < patch; i += 1) {
      out[k] = luma(frame, cx - half + i, cy - half + j);
      k += 1;
    }
  }
  return out;
}

function ncc(a: Float64Array, b: Float64Array): number {
  const n = a.length;
  if (n === 0) return 0;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i += 1) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= n;
  meanB /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const xa = a[i] - meanA;
    const xb = b[i] - meanB;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  const den = Math.sqrt(da * db);
  if (den < 1e-3) {
    let s = 0;
    for (let i = 0; i < n; i += 1) s += Math.abs(a[i] - b[i]);
    return 1 - s / (n * 255);
  }
  return num / den;
}


function searchMatch(
  frame: RgbaFrame,
  template: Float64Array,
  cx: number,
  cy: number,
  patch: number,
  search: number,
): { x: number; y: number; score: number } {
  let best = -Infinity;
  let bx = cx;
  let by = cy;
  for (let dy = -search; dy <= search; dy += 1) {
    for (let dx = -search; dx <= search; dx += 1) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) continue;
      const score = ncc(template, extractPatch(frame, x, y, patch));
      if (score > best) {
        best = score;
        bx = x;
        by = y;
      }
    }
  }
  return { x: bx, y: by, score: best };
}

/**
 * Normalized-cross-correlation point tracker.
 * Honest: this is template matching, not LocoTrack.
 */
export function nccTrack(
  frames: RgbaFrame[],
  seed: { x: number; y: number; frameIndex: number },
  opts: NccTrackOptions = {},
): TrackedPoint[] {
  if (frames.length === 0) return [];
  const patch = opts.patch ?? 15;
  const search = opts.search ?? 24;
  const minScore = opts.minScore ?? 0.55;
  const seedIndex = Math.max(0, Math.min(frames.length - 1, Math.round(seed.frameIndex)));
  const template = extractPatch(frames[seedIndex], seed.x, seed.y, patch);
  const samples: TrackedPoint[] = new Array(frames.length);

  const walk = (from: number, to: number) => {
    const step = to >= from ? 1 : -1;
    let x = seed.x;
    let y = seed.y;
    let missed = 0;
    let sawGap = false;
    for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
      if (i === seedIndex) {
        samples[i] = {
          frameIndex: i,
          x: seed.x,
          y: seed.y,
          score: 1,
          status: "visible",
        };
        x = seed.x;
        y = seed.y;
        missed = 0;
        continue;
      }
      const hit = searchMatch(frames[i], template, x, y, patch, search);
      if (hit.score >= minScore) {
        const status: TrackStatus = sawGap ? "recovered" : "visible";
        samples[i] = {
          frameIndex: i,
          x: hit.x,
          y: hit.y,
          score: hit.score,
          status,
        };
        x = hit.x;
        y = hit.y;
        missed = 0;
        sawGap = false;
      } else {
        missed += 1;
        sawGap = true;
        samples[i] = {
          frameIndex: i,
          x,
          y,
          score: hit.score,
          status: missed > 2 ? "lost" : "occluded",
        };
      }
    }
  };

  walk(seedIndex, frames.length - 1);
  walk(seedIndex, 0);
  return samples;
}
