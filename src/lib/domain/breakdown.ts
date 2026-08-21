/** Breakdown between two keys. Never generative. Never auto-creates. */

import { fail } from "./errors.ts";
import { midpointBreakdown, type TransitionComplexity } from "./transition-analysis.ts";

export const BREAKDOWN_MODES = ["blank", "copy", "mark"] as const;
export type BreakdownMode = (typeof BREAKDOWN_MODES)[number];

/** Drawing types the user may set. GENERATED_BREAKDOWN is generative — not here. */
export const BREAKDOWN_SET_TYPES = ["KEY", "BREAKDOWN", "INBETWEEN", "HOLD"] as const;
export type BreakdownSetType = (typeof BREAKDOWN_SET_TYPES)[number];

export type BreakdownSuggestion = {
  frame_number: number;
  reason: string;
};

export function isBreakdownMode(value: string): value is BreakdownMode {
  return (BREAKDOWN_MODES as readonly string[]).includes(value);
}

export function isBreakdownSetType(value: string): value is BreakdownSetType {
  return (BREAKDOWN_SET_TYPES as readonly string[]).includes(value);
}

export function interiorFrames(start: number, end: number): number[] {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  const out: number[] = [];
  for (let n = lo + 1; n < hi; n += 1) out.push(n);
  return out;
}

export function suggestBreakdownPositions(input: {
  start: number;
  end: number;
  complexity?: TransitionComplexity;
  occlusion?: boolean;
  contact_count?: number;
  pose_displacement?: number;
}): {
  frames: number[];
  suggestions: BreakdownSuggestion[];
  auto: false;
  reason: string;
  needs_insert: boolean;
} {
  const lo = Math.min(input.start, input.end);
  const hi = Math.max(input.start, input.end);
  const interior = interiorFrames(lo, hi);
  if (interior.length === 0) {
    return {
      frames: [],
      suggestions: [],
      auto: false,
      reason: "相鄰關鍵影格沒有中間格。可用空白 Breakdown 插入一格。",
      needs_insert: true,
    };
  }
  const clamp = (n: number) => {
    if (interior.includes(n)) return n;
    return interior[Math.floor((interior.length - 1) / 2)]!;
  };
  const suggestions: BreakdownSuggestion[] = [{ frame_number: clamp(midpointBreakdown(lo, hi)), reason: "中點分解" }];
  const rich =
    input.complexity === "HIGH" ||
    input.complexity === "VERY_HIGH" ||
    input.occlusion === true ||
    (input.contact_count ?? 0) > 0 ||
    (input.pose_displacement ?? 0) >= 0.7;
  if (rich && interior.length >= 3) {
    const third = clamp(lo + Math.round((hi - lo) / 3));
    const twoThird = clamp(lo + Math.round((2 * (hi - lo)) / 3));
    if (third !== suggestions[0]!.frame_number) {
      suggestions.push({ frame_number: third, reason: input.occlusion ? "遮擋前分解" : "前段分解" });
    }
    if (twoThird !== suggestions[0]!.frame_number && twoThird !== third) {
      suggestions.push({
        frame_number: twoThird,
        reason: (input.contact_count ?? 0) > 0 ? "接觸分解" : "後段分解",
      });
    }
  }
  const seen = new Set<number>();
  const unique = suggestions
    .filter((s) => {
      if (seen.has(s.frame_number)) return false;
      seen.add(s.frame_number);
      return true;
    })
    .sort((a, b) => a.frame_number - b.frame_number);
  return {
    frames: unique.map((s) => s.frame_number),
    suggestions: unique,
    auto: false,
    reason:
      unique.length > 1
        ? `建議 ${unique.length} 個分解位置，不會自動建立。`
        : `建議分解位置 F${unique[0]!.frame_number}，不會自動建立。`,
    needs_insert: false,
  };
}

export function resolveBreakdownTarget(input: {
  start: number;
  end: number;
  requested?: number;
}): { lo: number; hi: number; target: number; insert: boolean } {
  if (!Number.isFinite(input.start) || !Number.isFinite(input.end) || input.start === input.end) {
    fail("INVALID_KEYFRAME_PAIR", "Keyframe A/B required");
  }
  const lo = Math.min(input.start, input.end);
  const hi = Math.max(input.start, input.end);
  if (hi === lo + 1) {
    return { lo, hi, target: lo + 1, insert: true };
  }
  const mid = midpointBreakdown(lo, hi);
  const target = Number.isFinite(input.requested) ? Math.round(input.requested!) : mid;
  if (target <= lo || target >= hi) {
    fail("INVALID_KEYFRAME_PAIR", `Breakdown must sit between F${lo} and F${hi}`);
  }
  return { lo, hi, target, insert: false };
}

export function resolveCopySource(lo: number, hi: number, copyFrom: unknown): number {
  if (copyFrom === "end" || copyFrom === "B" || copyFrom === "b") return hi;
  if (copyFrom === "start" || copyFrom === "A" || copyFrom === "a" || copyFrom == null || copyFrom === "") {
    return lo;
  }
  const n = typeof copyFrom === "number" ? copyFrom : Number(copyFrom);
  if (!Number.isFinite(n)) return lo;
  return Math.round(n);
}
