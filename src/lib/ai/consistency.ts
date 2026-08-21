import type { ConsistencyCategory, ConsistencyResult } from "../domain/types.ts";
import {
  continuityScore,
  lumaVariance,
  meanAbsDiff,
  meanLuma,
  motionField,
  type RgbaFrame,
} from "../domain/pixel-metrics.ts";

const UNAVAILABLE: ConsistencyCategory[] = [
  "CHARACTER_IDENTITY",
  "FACE",
  "BODY",
  "HAND",
  "POSE",
  "CLOTHING",
  "OBJECT",
  "DEPTH",
  "CONTACT",
  "CAMERA",
];

export function scoreWindow(
  frames: { frameNumber: number; frameId: string; rgba: RgbaFrame }[],
): ConsistencyResult[] {
  if (frames.length === 0) return [];
  const lumas = frames.map((f) => meanLuma(f.rgba));
  const diffs: number[] = [0];
  const mag: number[] = [0];
  for (let i = 1; i < frames.length; i += 1) {
    diffs.push(meanAbsDiff(frames[i - 1].rgba, frames[i].rgba));
    mag.push(motionField(frames[i - 1].rgba, frames[i].rgba).magnitude);
  }
  const globalFlicker = lumaVariance(lumas);

  return frames.map((f, i) => {
    const pixel = continuityScore(diffs[i] ?? 0);
    const neighbors = lumas.slice(Math.max(0, i - 2), i + 3);
    const flicker = 1 - Math.min(1, lumaVariance(neighbors) * 18 + globalFlicker * 8);
    const motionSpike = 1 - Math.min(1, (mag[i] ?? 0) / 10);
    const lumaJump =
      i === 0 ? 1 : 1 - Math.min(1, Math.abs(lumas[i] - lumas[i - 1]) * 6);
    const scores = {
      pixel_continuity: round4(pixel),
      temporal_flicker: round4(Math.max(0, flicker)),
      motion_spike: round4(Math.max(0, motionSpike)),
      luma_jump: round4(Math.max(0, lumaJump)),
    };
    const min = Math.min(
      scores.pixel_continuity,
      scores.temporal_flicker,
      scores.motion_spike,
      scores.luma_jump,
    );
    const severity: ConsistencyResult["severity"] =
      min < 0.45 ? "error" : min < 0.7 ? "warning" : "ok";
    const categories: ConsistencyCategory[] = [];
    if (scores.temporal_flicker < 0.7) categories.push("TEMPORAL_FLICKER");
    if (scores.pixel_continuity < 0.7 || scores.motion_spike < 0.7) {
      categories.push("MOTION");
    }
    if (scores.luma_jump < 0.7) categories.push("BACKGROUND");
    const repairWindow: [number, number] | null =
      severity === "ok"
        ? null
        : [
            Math.max(frames[0].frameNumber, f.frameNumber - 4),
            Math.min(
              frames[frames.length - 1].frameNumber,
              f.frameNumber + 4,
            ),
          ];
    return {
      frame: f.frameNumber,
      frameId: f.frameId,
      scores,
      unavailable: UNAVAILABLE,
      severity,
      repairWindow,
      categories,
    };
  });
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
