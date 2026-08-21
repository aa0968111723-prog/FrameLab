/** Motion plan: timing, spacing, constraints. Versioned — never overwrite. */

import { sampleCurve } from "./motion-curve.ts";
import type { MotionCurve } from "./types.ts";
import type { AnimationConstraint } from "./animation-constraints.ts";

export type MotionCharacter = {
  character_id: string;
  motion: { direction: string; distance_normalized: number };
  pose_transition: Record<string, number | string>;
};

export type MotionObject = {
  object_id: string;
  constraint: string;
};

export type MotionPlan = {
  version: number;
  start_frame: number;
  end_frame: number;
  count: number;
  characters: MotionCharacter[];
  objects: MotionObject[];
  camera: { movement: "static" | "follow" | "unknown" };
  curve: MotionCurve;
  breakdowns: number[];
  constraints: AnimationConstraint[];
  tracks: { name: string; entity: string }[];
  contacts: AnimationConstraint[];
  timing: { frames: number; fps: number };
  spacing: number[];
  quality: "preview" | "production";
};

export function buildMotionPlan(input: {
  start: number;
  end: number;
  count: number;
  curve?: MotionCurve;
  fps?: number;
  characters?: MotionCharacter[];
  objects?: MotionObject[];
  camera?: MotionPlan["camera"];
  breakdowns?: number[];
  constraints?: AnimationConstraint[];
  quality?: "preview" | "production";
  version?: number;
}): MotionPlan {
  const count = Math.max(0, Math.round(input.count));
  const curve = input.curve ?? "ease_in_out";
  const spacing = sampleCurve(count, curve);
  const constraints = input.constraints ?? [];
  const characters = input.characters ?? [];
  const objects = input.objects ?? [];
  return {
    version: input.version ?? 1,
    start_frame: input.start,
    end_frame: input.end,
    count,
    characters,
    objects,
    camera: input.camera ?? { movement: "static" },
    curve,
    breakdowns: input.breakdowns ?? [],
    constraints,
    tracks: [
      ...characters.map((c) => ({ name: c.character_id, entity: "character" })),
      ...objects.map((o) => ({ name: o.object_id, entity: "object" })),
    ],
    contacts: constraints.filter((c) => c.kind === "MAINTAIN_CONTACT"),
    timing: { frames: count, fps: input.fps ?? 24 },
    spacing,
    quality: input.quality ?? "preview",
  };
}

export function motionProgressForFrame(plan: MotionPlan, generatedIndex: number): number {
  return plan.spacing[generatedIndex] ?? 0;
}

export function nextPlanVersion(previous: MotionPlan, patch: Partial<MotionPlan>): MotionPlan {
  return {
    ...previous,
    ...patch,
    version: previous.version + 1,
    spacing: patch.curve || patch.count != null ? sampleCurve(patch.count ?? previous.count, patch.curve ?? previous.curve) : previous.spacing,
    constraints: patch.constraints ?? previous.constraints,
  };
}

export function hashMotionPlan(plan: MotionPlan): string {
  const raw = JSON.stringify({
    s: plan.start_frame,
    e: plan.end_frame,
    c: plan.count,
    curve: plan.curve,
    q: plan.quality,
    cons: plan.constraints.map((x) => x.kind),
    bd: plan.breakdowns,
    v: plan.version,
  });
  let h = 0;
  for (let i = 0; i < raw.length; i += 1) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
