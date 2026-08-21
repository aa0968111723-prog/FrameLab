/** Minimal safe repair window. Protects keyframes and locked frames. */

import type { ProblemRange } from "./consistency-engine.ts";

export type FrameGuard = {
  frameNumber: number;
  frameType?: string;
  isLocked?: boolean;
};

export type RepairPlan = {
  problem_range: [number, number];
  repair_range: [number, number];
  protected_frames: number[];
  skipped_locked: number[];
  provider: string;
  reason: string;
  interpolation: "FULL_FRAME_INTERPOLATION";
};

export function planRepairWindow(
  problem: ProblemRange,
  frames: FrameGuard[],
  opts: { pad?: number; provider?: string } = {},
): RepairPlan {
  const pad = opts.pad ?? 2;
  const numbers = frames.map((f) => f.frameNumber).sort((a, b) => a - b);
  const min = numbers[0] ?? problem.start;
  const max = numbers[numbers.length - 1] ?? problem.end;
  let start = Math.max(min, problem.start - pad);
  let end = Math.min(max, problem.end + pad);

  const byNum = new Map(frames.map((f) => [f.frameNumber, f]));
  const protectedFrames: number[] = [];
  const skippedLocked: number[] = [];

  const leftKey = findBoundaryKey(frames, start, -1);
  const rightKey = findBoundaryKey(frames, end, 1);
  if (leftKey != null && leftKey < problem.start) {
    start = leftKey;
    protectedFrames.push(leftKey);
  }
  if (rightKey != null && rightKey > problem.end) {
    end = rightKey;
    protectedFrames.push(rightKey);
  }

  for (let n = start; n <= end; n += 1) {
    const f = byNum.get(n);
    if (f?.isLocked) {
      skippedLocked.push(n);
      if (!protectedFrames.includes(n)) protectedFrames.push(n);
    }
    if ((f?.frameType === "KEY" || f?.frameType === "BREAKDOWN") && (n === start || n === end)) {
      if (!protectedFrames.includes(n)) protectedFrames.push(n);
    }
  }

  const reasonParts = [
    `問題在 F${problem.start}–F${problem.end}（峰值 F${problem.peak_frame}）。`,
    "會擴到穩定的鄰近影格。",
  ];
  if (protectedFrames.length) {
    reasonParts.push(`邊界／鎖定影格 F${protectedFrames.join("、F")} 不會改。`);
  }

  return {
    problem_range: [problem.start, problem.end],
    repair_range: [start, end],
    protected_frames: protectedFrames.sort((a, b) => a - b),
    skipped_locked: skippedLocked,
    provider: opts.provider ?? "linear-blend",
    reason: reasonParts.join(" "),
    interpolation: "FULL_FRAME_INTERPOLATION",
  };
}

function findBoundaryKey(frames: FrameGuard[], from: number, dir: 1 | -1): number | null {
  const ordered = [...frames].sort((a, b) => a.frameNumber - b.frameNumber);
  if (dir < 0) {
    const left = ordered.filter((f) => f.frameNumber <= from && f.frameType === "KEY");
    return left.length ? left[left.length - 1].frameNumber : null;
  }
  const right = ordered.filter((f) => f.frameNumber >= from && f.frameType === "KEY");
  return right.length ? right[0].frameNumber : null;
}

export function interiorRepairFrames(plan: RepairPlan): number[] {
  const out: number[] = [];
  const protectedSet = new Set(plan.protected_frames);
  for (let n = plan.repair_range[0]; n <= plan.repair_range[1]; n += 1) {
    if (protectedSet.has(n)) continue;
    if (n === plan.repair_range[0] || n === plan.repair_range[1]) continue;
    out.push(n);
  }
  return out;
}
