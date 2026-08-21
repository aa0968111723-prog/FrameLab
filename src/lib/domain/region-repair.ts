/**
 * Region repair pipeline: selection → mask → temporal context → candidate → before/after.
 * Neighborhood bbox paste is 快速預覽 only. Never AI repair.
 */

export const REGION_REPAIR_STAGES = [
  "selection",
  "mask",
  "temporal",
  "candidate",
  "before_after",
] as const;

export type RegionRepairStage = (typeof REGION_REPAIR_STAGES)[number];

export type RegionMask = {
  frame: number;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence?: number;
  contour?: number[][];
  status?: string;
  source?: "sam2" | "rectangle";
};

export type RegionRepairRequest = {
  frames: number[];
  masks: RegionMask[];
  references: { frame: number }[];
  constraints: string[];
  temporal_context: { before: number; after: number };
};

export type RegionRepairResult = {
  ok: boolean;
  code?: string;
  message?: string;
  provider: string;
  frames?: { frame: number; note: string }[];
  evaluation_only?: string[];
};

export interface RegionRepairProvider {
  id: string;
  available: boolean;
  repair_region(req: RegionRepairRequest): Promise<RegionRepairResult>;
}

export const REGION_REPAIR_STAGE_ZH: Record<RegionRepairStage, string> = {
  selection: "選區",
  mask: "遮罩",
  temporal: "時間脈絡",
  candidate: "候選",
  before_after: "前後比較",
};

export function isAiRegionRepair(provider: string): boolean {
  return provider === "wan" || provider === "fal.ai" || provider === "fal" || provider === "comfyui";
}

export function isNeighborhoodPreview(method: string | undefined): boolean {
  const m = String(method ?? "").toLowerCase();
  return m === "preview" || m === "blend" || m === "neighborhood-preview" || m === "neighborhood-paste";
}

export function regionRepairUnavailableMessage(providerId = "wan"): string {
  return `生成修復尚未設定（${providerId} 未載入）。矩形鄰域貼上不是 AI 修復。`;
}

export function neighborhoodPreviewNote(): string {
  return "快速預覽：鄰域矩形貼上。不是 AI 修復。";
}

export type RegionRepairPipeline = {
  stages: { id: RegionRepairStage; label: string; done: boolean }[];
  current: RegionRepairStage;
  selection: { x: number; y: number; w: number; h: number } | null;
  mask: RegionMask | null;
  temporal: { before: number[]; current: number; after: number[] };
  provider: { id: string; available: boolean; ai: boolean };
  candidateId: string | null;
  available: boolean;
  ai: boolean;
  note: string;
};

export function usableBox(box: { w: number; h: number } | null | undefined, min = 4): boolean {
  if (!box) return false;
  if (box.w <= 1 && box.h <= 1) return box.w >= 0.002 && box.h >= 0.002;
  return box.w >= min && box.h >= min;
}

export function maskFromSelection(
  frame: number,
  box: { x: number; y: number; w: number; h: number } | null,
): RegionMask | null {
  if (!box || !usableBox(box)) return null;
  return { frame, ...box, source: "rectangle", confidence: 1 };
}

export function maskToPixels(
  mask: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  if (mask.w <= 1 && mask.h <= 1 && mask.x <= 1 && mask.y <= 1) {
    return {
      x: mask.x * width,
      y: mask.y * height,
      w: Math.max(1, mask.w * width),
      h: Math.max(1, mask.h * height),
    };
  }
  return { x: mask.x, y: mask.y, w: mask.w, h: mask.h };
}

export function temporalContext(
  frameNumber: number,
  frameNumbers: number[],
  beforeCount = 2,
  afterCount = 2,
): { before: number[]; current: number; after: number[] } {
  const sorted = [...new Set(frameNumbers)].sort((a, b) => a - b);
  const before = sorted.filter((n) => n < frameNumber).slice(-beforeCount);
  const after = sorted.filter((n) => n > frameNumber).slice(0, afterCount);
  return { before, current: frameNumber, after };
}

export function buildRegionRepairPipeline(input: {
  frameNumber: number;
  selection?: { x: number; y: number; w: number; h: number } | null;
  mask?: RegionMask | null;
  frameNumbers: number[];
  providerId?: string;
  providerAvailable?: boolean;
  candidateId?: string | null;
  beforeCount?: number;
  afterCount?: number;
}): RegionRepairPipeline {
  const selection = input.selection && usableBox(input.selection) ? input.selection : null;
  const mask =
    input.mask && usableBox(input.mask)
      ? { ...input.mask, frame: input.mask.frame ?? input.frameNumber, source: input.mask.source ?? "sam2" }
      : maskFromSelection(input.frameNumber, selection);
  const temporal = temporalContext(
    input.frameNumber,
    input.frameNumbers,
    input.beforeCount,
    input.afterCount,
  );
  const providerId = input.providerId ?? "wan";
  const available = input.providerAvailable === true;
  const ai = isAiRegionRepair(providerId) && available;
  const candidateId = input.candidateId ?? null;
  const hasTemporal = temporal.before.length + temporal.after.length > 0;
  const done: Record<RegionRepairStage, boolean> = {
    selection: Boolean(selection || mask),
    mask: Boolean(mask),
    temporal: hasTemporal,
    candidate: Boolean(candidateId),
    before_after: Boolean(candidateId),
  };
  let current: RegionRepairStage = "selection";
  if (done.selection) current = "mask";
  if (done.mask) current = "temporal";
  if (done.temporal) current = "candidate";
  if (done.candidate) current = "before_after";
  const note = candidateId
    ? ai
      ? "生成修復候選。尚未寫入時間軸。"
      : neighborhoodPreviewNote()
    : available
      ? "生成修復已載入，可產生候選。"
      : regionRepairUnavailableMessage(providerId);
  return {
    stages: REGION_REPAIR_STAGES.map((id) => ({
      id,
      label: REGION_REPAIR_STAGE_ZH[id],
      done: done[id],
    })),
    current,
    selection,
    mask,
    temporal,
    provider: { id: providerId, available, ai },
    candidateId,
    available,
    ai,
    note,
  };
}

/** Legacy name. Not AI repair. Neighborhood paste lives as method=preview. */
export class BlendRegionRepair implements RegionRepairProvider {
  id = "blend-region";
  available = false;
  async repair_region(_req: RegionRepairRequest): Promise<RegionRepairResult> {
    return {
      ok: false,
      code: "PROVIDER_NOT_AVAILABLE",
      message: regionRepairUnavailableMessage("wan"),
      provider: this.id,
    };
  }
}

export class SamRegionRepair implements RegionRepairProvider {
  id = "sam2";
  available = false;
  async repair_region(_req: RegionRepairRequest): Promise<RegionRepairResult> {
    return {
      ok: false,
      code: "MODEL_NOT_AVAILABLE",
      message: "SAM 2 produces masks, not inpaint. Generative repair is a separate provider.",
      provider: this.id,
    };
  }
}

export function propagateMask(
  seed: RegionMask,
  frames: number[],
  tracks: { frame_number: number; x: number; y: number; score?: number; status?: string }[],
): { frame: number; mask: RegionMask; confidence: number; lost: boolean }[] {
  const byFrame = new Map(tracks.map((t) => [t.frame_number, t]));
  const seedTrack = tracks.find((t) => t.frame_number === seed.frame);
  return frames.map((frame) => {
    const t = byFrame.get(frame);
    if (!t) {
      return { frame, mask: { ...seed, frame }, confidence: frame === seed.frame ? 1 : 0.2, lost: frame !== seed.frame };
    }
    const dx = seedTrack ? t.x - seedTrack.x : 0;
    const dy = seedTrack ? t.y - seedTrack.y : 0;
    const confidence = t.status === "lost" ? 0.15 : Math.max(0.2, t.score ?? 0.7);
    return {
      frame,
      mask: { frame, x: seed.x + dx, y: seed.y + dy, w: seed.w, h: seed.h, confidence },
      confidence,
      lost: t.status === "lost" || confidence < 0.35,
    };
  });
}

export function constraintHonesty(kind: string, providerCaps: { pose?: boolean; mask?: boolean }): {
  label: string;
  guaranteed: boolean;
  note: string;
} {
  const needsPose = /face|character|hair|clothing|body/i.test(kind);
  const guaranteed = needsPose ? Boolean(providerCaps.pose) : true;
  return {
    label: constraintKindZh(kind),
    guaranteed,
    note: guaranteed ? "已套用" : "僅評估",
  };
}

function constraintKindZh(kind: string) {
  const k = kind.toLowerCase();
  if (k.includes("character")) return "角色";
  if (k.includes("face")) return "臉";
  if (k.includes("hair")) return "頭髮";
  if (k.includes("clothing") || k.includes("cloth")) return "服裝";
  if (k.includes("body")) return "身體";
  if (k.includes("background")) return "背景";
  if (k.includes("contact")) return "接觸";
  if (k.includes("camera")) return "相機";
  if (k.includes("object")) return "物件";
  if (k.includes("pose")) return "姿態";
  return "約束";
}
