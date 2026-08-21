/** Minimal regeneration — never default to regenerating the whole span. */

export type GeneratedIssue = {
  frame: number;
  category: string;
  severity: "info" | "warning" | "error" | "critical";
};

export type FrameGuardLite = {
  frameNumber: number;
  frameType?: string;
  isLocked?: boolean;
};

export type RegenerationPlan = {
  problem_range: [number, number];
  regenerate_range: [number, number];
  boundary_start: number;
  boundary_end: number;
  protected_frames: number[];
  reason: string;
};

export function planMinimalRegeneration(
  issues: GeneratedIssue[],
  frames: FrameGuardLite[],
  span?: [number, number],
): RegenerationPlan | null {
  const bad = issues
    .filter((i) => i.severity === "error" || i.severity === "critical" || i.severity === "warning")
    .map((i) => i.frame)
    .sort((a, b) => a - b);
  if (bad.length === 0) return null;
  const problem: [number, number] = [bad[0], bad[bad.length - 1]];
  const byNum = new Map(frames.map((f) => [f.frameNumber, f]));
  const min = span?.[0] ?? Math.min(...frames.map((f) => f.frameNumber), problem[0]);
  const max = span?.[1] ?? Math.max(...frames.map((f) => f.frameNumber), problem[1]);

  const isStable = (n: number) => {
    const f = byNum.get(n);
    if (!f) return false;
    if (f.isLocked) return true;
    if (f.frameType === "KEY" || f.frameType === "BREAKDOWN" || f.frameType === "GENERATED_BREAKDOWN") return true;
    return !bad.includes(n);
  };

  let left = problem[0] - 1;
  while (left > min && !isStable(left)) left -= 1;
  if (left < min) left = min;
  let right = problem[1] + 1;
  while (right < max && !isStable(right)) right += 1;
  if (right > max) right = max;

  const protectedFrames: number[] = [];
  for (const n of [left, right]) {
    const f = byNum.get(n);
    if (f?.frameType === "KEY" || f?.frameType === "BREAKDOWN" || f?.isLocked) protectedFrames.push(n);
  }

  const regenStart = left + (isStable(left) ? 1 : 0);
  const regenEnd = right - (isStable(right) ? 1 : 0);

  return {
    problem_range: problem,
    regenerate_range: [Math.min(regenStart, regenEnd), Math.max(regenStart, regenEnd)],
    boundary_start: left,
    boundary_end: right,
    protected_frames: protectedFrames,
    reason: `只有 F${problem[0]}–F${problem[1]} 出問題。邊界 F${left} / F${right}。關鍵影格與鎖定影格不會被改寫。`,
  };
}

export function assertNotProtected(frameNumber: number, frames: FrameGuardLite[]): boolean {
  const f = frames.find((x) => x.frameNumber === frameNumber);
  if (!f) return true;
  if (f.isLocked) return false;
  if (f.frameType === "KEY") return false;
  return true;
}
