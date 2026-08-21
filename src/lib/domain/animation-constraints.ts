/** Animation constraints. Evaluated after generation if the provider cannot enforce them. */

export const CONSTRAINT_KINDS = [
  "PRESERVE_CHARACTER",
  "PRESERVE_FACE",
  "PRESERVE_BACKGROUND",
  "PRESERVE_CLOTHING",
  "PRESERVE_HAIR",
  "PRESERVE_BODY",
  "PRESERVE_OBJECT",
  "MAINTAIN_CONTACT",
  "LOCK_REGION",
  "LOCK_KEYFRAME",
  "KEEP_CAMERA_STATIC",
] as const;

export type ConstraintKind = (typeof CONSTRAINT_KINDS)[number];

export type AnimationConstraint = {
  kind: ConstraintKind;
  label?: string;
  source_entity?: string | null;
  source_point?: string | null;
  target_entity?: string | null;
  target_region?: string | null;
  start_frame?: number | null;
  end_frame?: number | null;
  strength?: number;
};

export type ContactConstraint = {
  source_entity: string;
  source_point: string;
  target_entity: string;
  target_region: string;
  start_frame: number;
  end_frame: number;
  strength: number;
};

export type InbetweenCapabilities = {
  supports_frame_pair: boolean;
  supports_multi_frame: boolean;
  supports_pose_guidance: boolean;
  supports_mask: boolean;
  supports_motion_guidance: boolean;
  supports_seed: boolean;
  supports_character_reference: boolean;
  supports_resolution: boolean;
  test_only?: boolean;
};

const ENFORCEABLE: Record<ConstraintKind, (c: InbetweenCapabilities) => boolean> = {
  PRESERVE_CHARACTER: (c) => c.supports_character_reference || c.supports_mask,
  PRESERVE_FACE: (c) => c.supports_mask || c.supports_pose_guidance,
  PRESERVE_BACKGROUND: (c) => c.supports_mask,
  PRESERVE_CLOTHING: (c) => c.supports_mask,
  PRESERVE_HAIR: (c) => c.supports_mask,
  PRESERVE_BODY: (c) => c.supports_character_reference || c.supports_mask,
  PRESERVE_OBJECT: (c) => c.supports_mask,
  MAINTAIN_CONTACT: (c) => c.supports_pose_guidance,
  LOCK_REGION: (c) => c.supports_mask,
  LOCK_KEYFRAME: () => true,
  KEEP_CAMERA_STATIC: (c) => c.supports_motion_guidance,
};

const WARNING_COPY: Partial<Record<ConstraintKind, string>> = {
  PRESERVE_BACKGROUND: "This provider cannot guarantee background preservation.",
  PRESERVE_FACE: "Face Lock · evaluation only. Constraint will be evaluated after generation but cannot be enforced during generation.",
  PRESERVE_HAIR: "Hair Lock · evaluation only.",
  PRESERVE_CLOTHING: "Clothing Lock · evaluation only.",
  PRESERVE_BODY: "Body proportion lock · evaluation only.",
  MAINTAIN_CONTACT: "Constraint will be evaluated after generation but cannot be enforced during generation.",
};

export function constraintWarnings(
  constraints: AnimationConstraint[],
  caps: InbetweenCapabilities,
): { constraint: ConstraintKind; message: string }[] {
  const out: { constraint: ConstraintKind; message: string }[] = [];
  for (const c of constraints) {
    if (ENFORCEABLE[c.kind]?.(caps)) continue;
    out.push({
      constraint: c.kind,
      message:
        WARNING_COPY[c.kind] ??
        `${c.kind} will be evaluated after generation but cannot be enforced during generation by this provider.`,
    });
  }
  return out;
}

export function contactFromPair(
  source: string,
  sourcePoint: string,
  target: string,
  start: number,
  end: number,
): AnimationConstraint {
  return {
    kind: "MAINTAIN_CONTACT",
    label: `${sourcePoint} ↔ ${target}`,
    source_entity: source,
    source_point: sourcePoint,
    target_entity: target,
    target_region: target,
    start_frame: start,
    end_frame: end,
    strength: 1,
  };
}
