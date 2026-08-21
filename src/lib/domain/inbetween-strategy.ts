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
  const interp = input.interpolationId ?? "linear-blend";
  const gen = input.generativeId ?? "wan";
  if (input.complexity === "VERY_HIGH") {
    return {
      kind: "suggest_breakdown",
      provider: interp,
      reason: "Pose / occlusion is large. Suggest a breakdown frame before filling 9 inbetweens.",
      fallback: input.interpolationAvailable ? interp : undefined,
    };
  }
  if (input.complexity === "HIGH") {
    if (input.generativeAvailable) {
      return {
        kind: "generative",
        provider: gen,
        reason: "Large pose change — prefer a generative inbetween provider.",
        fallback: input.interpolationAvailable ? interp : undefined,
      };
    }
    return {
      kind: "interpolation",
      provider: interp,
      reason: "Generative inbetween is MODEL_NOT_AVAILABLE. Falling back to linear-blend interpolation.",
    };
  }
  if (input.complexity === "MEDIUM") {
    return {
      kind: "interpolation",
      provider: interp,
      reason: "Medium motion — interpolation with motion-curve guidance.",
    };
  }
  return {
    kind: "interpolation",
    provider: interp,
    reason: "Small motion — traditional interpolation.",
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
