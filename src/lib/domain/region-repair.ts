/**
 * RegionRepairProvider — provider-agnostic region repair.
 * V0.4 ships a real blend adapter. SAM / generative stay honest unavailable.
 */

export type RegionMask = {
  frame: number;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence?: number;
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

export class BlendRegionRepair implements RegionRepairProvider {
  id = "blend-region";
  available = true;
  async repair_region(req: RegionRepairRequest): Promise<RegionRepairResult> {
    if (req.masks.length === 0) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "No region mask. Draw a rectangle on the canvas.",
        provider: this.id,
      };
    }
    const evaluation = req.constraints.filter((c) =>
      /face|hair|clothing|character/i.test(c),
    );
    return {
      ok: true,
      provider: this.id,
      frames: req.frames.map((frame) => ({
        frame,
        note: "Neighborhood blend of the boxed region. Not SAM.",
      })),
      evaluation_only: evaluation.length
        ? evaluation.map((c) => `${c} · evaluation only on linear-blend`)
        : undefined,
    };
  }
}

export class SamRegionRepair implements RegionRepairProvider {
  id = "sam2";
  available = false;
  async repair_region(): Promise<RegionRepairResult> {
    return {
      ok: false,
      code: "MODEL_NOT_AVAILABLE",
      message: "SAM2 checkpoint is not loaded. Rectangle mask is used instead.",
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
    label: kind,
    guaranteed,
    note: guaranteed ? "Enforced" : "Evaluation only",
  };
}
