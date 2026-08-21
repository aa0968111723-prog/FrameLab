/** Deterministic NL → InbetweenIntent. LLM may suggest; Context Engine validates numbers. */

import type { MotionCurve } from "./types.ts";
import type { AnimationConstraint, ConstraintKind } from "./animation-constraints.ts";
import { contactFromPair } from "./animation-constraints.ts";

export type InbetweenIntent = {
  count: number | null;
  curve: MotionCurve | null;
  constraints: AnimationConstraint[];
  want_breakdown: boolean;
  start_frame: number | null;
  end_frame: number | null;
};

const CURVE_MAP: { re: RegExp; curve: MotionCurve }[] = [
  { re: /慢慢加速|ease\s*in(?!\s*out)|slow\s*in/i, curve: "ease_in" },
  { re: /慢慢停|慢慢結束|慢慢结束|ease\s*out|slow\s*out/i, curve: "ease_out" },
  { re: /柔和|ease\s*in\s*out|soft|gentle|smooth/i, curve: "ease_in_out" },
  { re: /停格|hold|不要動|不要动/i, curve: "hold" },
  { re: /線性|线性|linear|機械|机械/i, curve: "linear" },
];

const CONSTRAINT_MAP: { re: RegExp; kind: ConstraintKind }[] = [
  { re: /臉.*不要|脸.*不要|preserve\s*face|face\s*stay/i, kind: "PRESERVE_FACE" },
  { re: /背景不要|背景.*不要|preserve\s*background|background\s*stay/i, kind: "PRESERVE_BACKGROUND" },
  { re: /衣服|clothing/i, kind: "PRESERVE_CLOTHING" },
  { re: /角色不要變|角色不要变|preserve\s*character/i, kind: "PRESERVE_CHARACTER" },
  { re: /鏡頭不要|镜头不要|camera\s*static|keep\s*camera/i, kind: "KEEP_CAMERA_STATIC" },
  { re: /抓著|抓住|抓着|接觸|接触|contact|hand.*suitcase|行李箱/i, kind: "MAINTAIN_CONTACT" },
];

export function parseAnimationIntent(text: string, ctx?: { start?: number; end?: number }): InbetweenIntent {
  const countMatch =
    text.match(/補\s*(\d+)\s*幀/) ||
    text.match(/补\s*(\d+)\s*帧/) ||
    text.match(/(\d+)\s*(?:inbetweens?|frames?)/i);
  const range = text.match(/F\s*(\d+)\s*(?:到|→|-|–|—)\s*F?\s*(\d+)/i);
  const constraints: AnimationConstraint[] = [];
  for (const row of CONSTRAINT_MAP) {
    if (!row.re.test(text)) continue;
    if (row.kind === "MAINTAIN_CONTACT") {
      constraints.push(
        contactFromPair(
          "character",
          "right_hand",
          "suitcase",
          ctx?.start ?? 0,
          ctx?.end ?? 0,
        ),
      );
    } else {
      constraints.push({ kind: row.kind });
    }
  }
  let curve: MotionCurve | null = null;
  for (const row of CURVE_MAP) {
    if (row.re.test(text)) {
      curve = row.curve;
      break;
    }
  }
  return {
    count: countMatch ? Number(countMatch[1]) : null,
    curve,
    constraints,
    want_breakdown: /breakdown|中間姿勢|中间姿势|先拆/i.test(text),
    start_frame: range ? Number(range[1]) : ctx?.start ?? null,
    end_frame: range ? Number(range[2]) : ctx?.end ?? null,
  };
}

export function isInbetweenRequest(text: string): boolean {
  return /補\s*\d+\s*幀|补\s*\d+\s*帧|inbetween|中間.*幀|中间.*帧|這兩張.*補|这两张.*补|generate\s+\d+\s+frame/i.test(text);
}

/** Spec §98 — curve change without a new pair. Do not regenerate the whole span by default. */
export function isCurveAdjustRequest(text: string): boolean {
  if (isInbetweenRequest(text)) return false;
  return /太機械|太机械|柔和一[點点]|太硬|太直線|太直线|ease|smooth(er)?|less mechanical/i.test(text);
}

export function intentToConstraintFlags(intent: InbetweenIntent) {
  const kinds = new Set(intent.constraints.map((c) => c.kind));
  return {
    preserveCharacter: kinds.has("PRESERVE_CHARACTER"),
    preserveFace: kinds.has("PRESERVE_FACE"),
    preserveBackground: kinds.has("PRESERVE_BACKGROUND"),
    maintainContact: kinds.has("MAINTAIN_CONTACT"),
    keepCameraStatic: kinds.has("KEEP_CAMERA_STATIC"),
  };
}
