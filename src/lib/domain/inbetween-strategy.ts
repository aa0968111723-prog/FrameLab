/** Route complexity → interpolation vs generative. Never hardcode a model. */

import type { InbetweenCapabilities } from "./animation-constraints.ts";
import type { TransitionComplexity } from "./transition-analysis.ts";

export type InbetweenStrategy = {
  kind: "interpolation" | "generative" | "suggest_breakdown";
  provider: string;
  reason: string;
  fallback?: string;
};

export function resolveInbetweenStrategy(input: {
  complexity: TransitionComplexity;
  interpolationAvailable: boolean;
  generativeAvailable: boolean;
  interpolationId?: string;
  generativeId?: string;
}): InbetweenStrategy {
  const interp = input.interpolationId ?? "rife";
  const gen = input.generativeId ?? "wan";
  if (input.complexity === "VERY_HIGH") {
    return {
      kind: "suggest_breakdown",
      provider: interp,
      reason: "姿態／遮擋變化很大。建議先加分解影格，再補中間影格。",
      fallback: input.interpolationAvailable ? interp : undefined,
    };
  }
  if (input.complexity === "HIGH") {
    if (input.generativeAvailable) {
      return {
        kind: "generative",
        provider: gen,
        reason: "姿態變化大 — 較適合生成式中間影格供應商。",
        fallback: input.interpolationAvailable ? interp : undefined,
      };
    }
    return {
      kind: "interpolation",
      provider: interp,
      reason: "生成式中間影格為 MODEL_NOT_AVAILABLE。改用 RIFE 中割。",
    };
  }
  if (input.complexity === "MEDIUM") {
    return {
      kind: "interpolation",
      provider: interp,
      reason: "中等運動 — 以運動曲線引導插值。",
    };
  }
  return {
    kind: "interpolation",
    provider: interp,
    reason: "小幅運動 — 傳統插值。",
  };
}

export function linearBlendCapabilities(): InbetweenCapabilities {
  return {
    supports_frame_pair: true,
    supports_multi_frame: true,
    supports_pose_guidance: false,
    supports_mask: false,
    supports_motion_guidance: true,
    supports_seed: false,
    supports_character_reference: false,
    supports_resolution: true,
  };
}

export function reservedGenerativeCapabilities(): InbetweenCapabilities {
  return {
    supports_frame_pair: true,
    supports_multi_frame: true,
    supports_pose_guidance: true,
    supports_mask: true,
    supports_motion_guidance: true,
    supports_seed: true,
    supports_character_reference: true,
    supports_resolution: true,
  };
}
