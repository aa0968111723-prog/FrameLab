import { applyCurve } from "../domain/motion-curve.ts";
import type { MotionCurve } from "../domain/types.ts";

export type CurvePoint = { t: number; v: number };

export function curvePolyline(curve: MotionCurve | string, samples = 24): CurvePoint[] {
  const name = (curve || "linear") as MotionCurve;
  const out: CurvePoint[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    out.push({ t, v: applyCurve(t, name) });
  }
  return out;
}

export function curvePathD(curve: MotionCurve | string, w = 120, h = 48, pad = 4): string {
  const pts = curvePolyline(curve, 32);
  return pts
    .map((p, i) => {
      const x = pad + p.t * (w - pad * 2);
      const y = h - pad - p.v * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Spacing view: positions of inbetween samples along a 0–1 track. Ease-in packs later. */
export function spacingDots(count: number, curve: MotionCurve | string): number[] {
  if (count <= 0) return [0, 1];
  const name = (curve || "linear") as MotionCurve;
  const dots = [0];
  for (let i = 1; i <= count; i += 1) {
    dots.push(applyCurve(i / (count + 1), name));
  }
  dots.push(1);
  return dots;
}

export function curveCaption(curve: MotionCurve | string): string {
  switch (curve) {
    case "ease_in":
      return "緩入 · 加速";
    case "ease_out":
      return "緩出 · 減速";
    case "ease_in_out":
      return "緩入緩出 · 慢—快—慢";
    case "hold":
      return "停留 · 結尾才動";
    case "linear":
      return "線性 · 均勻間距";
    default:
      return String(curve);
  }
}
