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
  PRESERVE_BACKGROUND: "這個供應商無法保證背景不變。",
  PRESERVE_FACE: "鎖定臉 · 僅評估。產生時無法強制，完成後才會檢查。",
  PRESERVE_HAIR: "鎖定頭髮 · 僅評估。",
  PRESERVE_CLOTHING: "鎖定服裝 · 僅評估。",
  PRESERVE_BODY: "鎖定身體比例 · 僅評估。",
  MAINTAIN_CONTACT: "接觸約束僅評估，產生時無法強制。",
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
        `${constraintZh(c.kind)} 僅評估，這個供應商產生時無法強制。`,
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

function constraintZh(kind: string) {
  if (kind.includes("CHARACTER")) return "角色";
  if (kind.includes("FACE")) return "臉";
  if (kind.includes("BACKGROUND")) return "背景";
  if (kind.includes("CONTACT")) return "接觸";
  if (kind.includes("CAMERA")) return "相機";
  if (kind.includes("OBJECT")) return "物件";
  if (kind.includes("CLOTHING")) return "服裝";
  if (kind.includes("HAIR")) return "頭髮";
  if (kind.includes("BODY")) return "身體";
  if (kind.includes("REGION")) return "區域";
  if (kind.includes("KEYFRAME")) return "關鍵影格";
  return kind.replaceAll("_", " ");
}

