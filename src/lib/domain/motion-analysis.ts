/** Real block-match motion analysis. Not SEA-RAFT. */

import { cropRgba } from "./lightweight-analysis.ts";
import {
  motionField,
  motionGrid,
  type MotionVector,
  type RegionBox,
  type RgbaFrame,
} from "./pixel-metrics.ts";

export type MotionPairSummary = {
  frame_a: number;
  frame_b: number;
  mean_motion: number;
  median_motion: number;
  dominant_direction: { x: number; y: number };
  velocity_ratio: number | null;
  direction_change_deg: number | null;
  region: boolean;
  provider: string;
  spike: boolean;
  grid: MotionVector[];
  motion_bbox: { x: number; y: number; w: number; h: number } | null;
  confidence: number;
};

export type MotionSpike = {
  frame_a: number;
  frame_b: number;
  velocity_ratio: number;
  direction_change_deg: number;
  mean_motion: number;
};

const VELOCITY_SPIKE = 2.0;
const DIRECTION_SPIKE_DEG = 55;

export function summarizePair(
  a: RgbaFrame,
  b: RgbaFrame,
  frameA: number,
  frameB: number,
  prevMean: number | null,
  prevDir: { x: number; y: number } | null,
  opts: { region?: RegionBox | null; provider?: string } = {},
): MotionPairSummary {
  const croppedA = opts.region ? cropRgba(a, opts.region) : a;
  const croppedB = opts.region ? cropRgba(b, opts.region) : b;
  const field = motionField(croppedA, croppedB);
  const grid = motionGrid(croppedA, croppedB, 48);
  const mags = grid.map((g) => g.mag).sort((x, y) => x - y);
  const median = mags.length ? mags[Math.floor(mags.length / 2)] : field.magnitude;
  const dir = {
    x: Math.cos(field.direction),
    y: Math.sin(field.direction),
  };
  const velocity_ratio =
    prevMean != null && prevMean > 0.15 ? field.magnitude / prevMean : null;
  let direction_change_deg: number | null = null;
  if (prevDir) {
    const dot = Math.max(-1, Math.min(1, dir.x * prevDir.x + dir.y * prevDir.y));
    direction_change_deg = (Math.acos(dot) * 180) / Math.PI;
  }
  const spike =
    (velocity_ratio != null && velocity_ratio >= VELOCITY_SPIKE) ||
    (direction_change_deg != null &&
      direction_change_deg >= DIRECTION_SPIKE_DEG &&
      field.magnitude > 0.8);
  const strong = grid.filter((g) => g.mag >= Math.max(0.4, field.magnitude * 0.45));
  let motion_bbox: MotionPairSummary["motion_bbox"] = null;
  if (strong.length) {
    const xs = strong.map((g) => g.x);
    const ys = strong.map((g) => g.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    motion_bbox = {
      x: minX,
      y: minY,
      w: Math.max(1, Math.max(...xs) - minX),
      h: Math.max(1, Math.max(...ys) - minY),
    };
  }
  const confidence = Math.max(
    0.2,
    Math.min(0.95, 1 - Math.min(0.7, (field.magnitude > 0 ? 0.12 : 0.4) + (mags.length < 4 ? 0.2 : 0))),
  );
  return {
    frame_a: frameA,
    frame_b: frameB,
    mean_motion: round3(field.magnitude),
    median_motion: round3(median),
    dominant_direction: { x: round3(dir.x), y: round3(dir.y) },
    velocity_ratio: velocity_ratio == null ? null : round3(velocity_ratio),
    direction_change_deg:
      direction_change_deg == null ? null : round3(direction_change_deg),
    region: Boolean(opts.region),
    provider: opts.provider ?? "block-match-16",
    spike,
    grid,
    motion_bbox,
    confidence: round3(confidence),
  };
}

export function analyzeMotionSequence(
  frames: { number: number; rgba: RgbaFrame }[],
  opts: {
    region?: RegionBox | null;
    provider?: string;
    regionFor?: (frameB: number) => RegionBox | null;
  } = {},
): MotionPairSummary[] {
  const out: MotionPairSummary[] = [];
  let prevMean: number | null = null;
  let prevDir: { x: number; y: number } | null = null;
  for (let i = 1; i < frames.length; i += 1) {
    const region = opts.regionFor?.(frames[i].number) ?? opts.region ?? null;
    const pair = summarizePair(
      frames[i - 1].rgba,
      frames[i].rgba,
      frames[i - 1].number,
      frames[i].number,
      prevMean,
      prevDir,
      { region, provider: opts.provider },
    );
    out.push(pair);
    prevMean = pair.mean_motion;
    prevDir = pair.dominant_direction;
  }
  return out;
}

export function motionSpikes(pairs: MotionPairSummary[]): MotionSpike[] {
  return pairs
    .filter((p) => p.spike)
    .map((p) => ({
      frame_a: p.frame_a,
      frame_b: p.frame_b,
      velocity_ratio: p.velocity_ratio ?? 1,
      direction_change_deg: p.direction_change_deg ?? 0,
      mean_motion: p.mean_motion,
    }));
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

export function shiftRegion(
  region: RegionBox,
  dx: number,
  dy: number,
  bounds: { width: number; height: number },
): RegionBox {
  return {
    x: Math.max(0, Math.min(Math.max(0, bounds.width - region.w), region.x + dx)),
    y: Math.max(0, Math.min(Math.max(0, bounds.height - region.h), region.y + dy)),
    w: region.w,
    h: region.h,
  };
}

/** Offset a region using an NCC/track point that started inside it. */
export function propagateRegionByTrack(
  region: RegionBox,
  seedFrame: number,
  frameNumber: number,
  tracks: { name: string; frame: number; x: number; y: number }[],
  bounds: { width: number; height: number },
): RegionBox {
  const seed = tracks.find(
    (t) =>
      t.frame === seedFrame &&
      t.x >= region.x &&
      t.x <= region.x + region.w &&
      t.y >= region.y &&
      t.y <= region.y + region.h,
  );
  if (!seed) return region;
  const at = tracks.find((t) => t.name === seed.name && t.frame === frameNumber);
  if (!at) return region;
  return shiftRegion(region, at.x - seed.x, at.y - seed.y, bounds);
}
