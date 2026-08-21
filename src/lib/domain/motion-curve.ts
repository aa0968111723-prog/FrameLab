import type { MotionCurve } from "./types.ts";

export function applyCurve(t: number, curve: MotionCurve): number {
  const x = Math.min(1, Math.max(0, t));
  switch (curve) {
    case "linear":
      return x;
    case "ease_in":
      return x * x * x;
    case "ease_out":
      return 1 - (1 - x) * (1 - x) * (1 - x);
    case "ease_in_out":
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    case "hold":
      return x < 1 ? 0 : 1;
    case "custom":
      return x;
    default:
      return x;
  }
}

export function sampleCurve(
  count: number,
  curve: MotionCurve,
): number[] {
  if (count <= 0) return [];
  const out: number[] = [];
  for (let i = 1; i <= count; i += 1) {
    out.push(applyCurve(i / (count + 1), curve));
  }
  return out;
}

/** Piecewise-linear custom curve from knots in [0,1] over normalized time. */
export function applyCustomCurve(t: number, knots: number[]): number {
  if (knots.length === 0) return applyCurve(t, "linear");
  const x = Math.min(1, Math.max(0, t));
  if (knots.length === 1) return Math.min(1, Math.max(0, knots[0]));
  const scaled = x * (knots.length - 1);
  const i = Math.min(knots.length - 2, Math.floor(scaled));
  const f = scaled - i;
  const a = knots[i];
  const b = knots[i + 1];
  return Math.min(1, Math.max(0, a * (1 - f) + b * f));
}
