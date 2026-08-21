/** Temporal Consistency Engine v1 — fuses motion, pose, tracking, visual, contact. */

import type { MotionPairSummary } from "./motion-analysis.ts";
import type { PoseContinuityEvent } from "./pose-lite.ts";
import type { TrackBreak } from "./track-continuity.ts";
import type { ContactEvent } from "./contact.ts";

export const SEVERITIES = ["info", "warning", "error", "critical"] as const;
export type AssistSeverity = (typeof SEVERITIES)[number];

export type ConsistencyKind =
  | "MOTION_CONTINUITY"
  | "POSE_CONTINUITY"
  | "TRACKING_CONTINUITY"
  | "CHARACTER_STABILITY"
  | "OBJECT_STABILITY"
  | "CONTACT_CONTINUITY"
  | "TEMPORAL_FLICKER"
  | "FACE"
  | "HAND"
  | "CLOTHING"
  | "BACKGROUND"
  | "DEPTH";

/** Architecture reserved — no detector in V0.2. Do not emit fake findings. */
export const RESERVED_CONSISTENCY_KINDS = [
  "FACE",
  "HAND",
  "CLOTHING",
  "BACKGROUND",
  "DEPTH",
] as const;

export type ConsistencyFinding = {
  type: ConsistencyKind;
  score: number;
  severity: AssistSeverity;
  evidence: Record<string, number | string | boolean>;
  explanation: string;
  frame: number;
  related_frames: number[];
};

export type ProblemFrame = {
  frame_id: string | null;
  frame_number: number;
  category: ConsistencyKind;
  severity: AssistSeverity;
  score: number;
  reason: string;
  evidence: Record<string, number | string | boolean>;
  region?: { x: number; y: number; w: number; h: number } | null;
  related_frames: number[];
};

export type ProblemRange = {
  start: number;
  end: number;
  peak_frame: number;
  category: ConsistencyKind;
  severity: AssistSeverity;
  score: number;
  reason: string;
  frames: number[];
  region?: { x: number; y: number; w: number; h: number } | null;
};

function scoreFromRatio(ratio: number) {
  if (ratio <= 1.2) return 0.95;
  if (ratio >= 3.5) return 0.2;
  return Math.max(0.2, 1 - (ratio - 1.2) / 2.8);
}

function severityOf(score: number): AssistSeverity {
  if (score < 0.3) return "critical";
  if (score < 0.45) return "error";
  if (score < 0.7) return "warning";
  return "info";
}

export function fuseConsistency(input: {
  motion?: MotionPairSummary[];
  poseEvents?: PoseContinuityEvent[];
  trackBreaks?: TrackBreak[];
  contacts?: ContactEvent[];
  flicker?: { frame: number; score: number }[];
}): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = [];
  for (const p of input.motion ?? []) {
    if (!p.spike && (p.velocity_ratio ?? 1) < 1.6) continue;
    const ratio = p.velocity_ratio ?? 1;
    const score = scoreFromRatio(ratio);
    findings.push({
      type: "MOTION_CONTINUITY",
      score,
      severity: severityOf(score),
      evidence: {
        velocity_ratio: p.velocity_ratio ?? 0,
        direction_change_deg: p.direction_change_deg ?? 0,
        mean_motion: p.mean_motion,
        provider: p.provider,
      },
      explanation: explainMotion(p),
      frame: p.frame_b,
      related_frames: [p.frame_a, p.frame_b],
    });
  }
  for (const e of input.poseEvents ?? []) {
    const ratio = e.velocity > 0 ? Math.max(1, e.acceleration / Math.max(0.2, e.velocity - e.acceleration)) : 1;
    const score = e.kind === "MISSING_KEYPOINT" ? 0.55 : scoreFromRatio(Math.max(2, Math.abs(e.acceleration) / 8));
    findings.push({
      type: "POSE_CONTINUITY",
      score,
      severity: severityOf(score),
      evidence: {
        joint: e.joint,
        velocity: e.velocity,
        acceleration: e.acceleration,
        displacement: e.displacement,
        kind: e.kind,
      },
      explanation: explainPose(e),
      frame: e.frame_b,
      related_frames: [e.frame_a, e.frame_b],
    });
    void ratio;
  }
  for (const t of input.trackBreaks ?? []) {
    const score = t.severity === "error" ? 0.4 : 0.58;
    findings.push({
      type: "TRACKING_CONTINUITY",
      score,
      severity: t.severity,
      evidence: { jump: t.jump, from: t.from, to: t.to, name: t.name },
      explanation: t.note,
      frame: t.frame,
      related_frames: [Math.max(0, t.frame - 1), t.frame],
    });
  }
  for (const c of input.contacts ?? []) {
    const score = c.severity === "error" ? 0.42 : 0.57;
    findings.push({
      type: "CONTACT_CONTINUITY",
      score,
      severity: c.severity,
      evidence: { distance: c.distance, median: c.median, pair: c.pair.join("·") },
      explanation: `F${c.frame} 可能接觸中斷：${c.pair[0]} 與 ${c.pair[1]}（距離啟發式，不是物理模擬）。`,
      frame: c.frame,
      related_frames: [Math.max(0, c.frame - 1), c.frame],
    });
  }
  for (const f of input.flicker ?? []) {
    if (f.score >= 0.7) continue;
    findings.push({
      type: "TEMPORAL_FLICKER",
      score: f.score,
      severity: severityOf(f.score),
      evidence: { flicker: f.score },
      explanation: `F${f.frame} 附近亮度閃爍。`,
      frame: f.frame,
      related_frames: [f.frame],
    });
  }
  return findings;
}

export function toProblemFrames(
  findings: ConsistencyFinding[],
  idOf: (n: number) => string | null = () => null,
  region?: { x: number; y: number; w: number; h: number } | null,
): ProblemFrame[] {
  return findings
    .filter((f) => f.severity !== "info")
    .map((f) => ({
      frame_id: idOf(f.frame),
      frame_number: f.frame,
      category: f.type,
      severity: f.severity,
      score: f.score,
      reason: f.explanation,
      evidence: f.evidence,
      region: region ?? null,
      related_frames: f.related_frames,
    }));
}

export function mergeProblemRanges(problems: ProblemFrame[], gap = 2): ProblemRange[] {
  if (problems.length === 0) return [];
  const sorted = [...problems].sort((a, b) => a.frame_number - b.frame_number);
  const groups: ProblemFrame[][] = [];
  let cur: ProblemFrame[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = cur[cur.length - 1];
    if (sorted[i].frame_number - prev.frame_number <= gap + 1) {
      cur.push(sorted[i]);
    } else {
      groups.push(cur);
      cur = [sorted[i]];
    }
  }
  groups.push(cur);
  return groups.map((g) => {
    const peak = [...g].sort((a, b) => a.score - b.score)[0];
    const worst = rank(peak.severity);
    return {
      start: g[0].frame_number,
      end: g[g.length - 1].frame_number,
      peak_frame: peak.frame_number,
      category: peak.category,
      severity: g.reduce((s, p) => (rank(p.severity) > rank(s) ? p.severity : s), "info" as AssistSeverity),
      score: peak.score,
      reason: peak.reason,
      frames: [...new Set(g.map((p) => p.frame_number))],
      region: peak.region ?? null,
    };
    void worst;
  });
}

function rank(s: AssistSeverity) {
  return { info: 0, warning: 1, error: 2, critical: 3 }[s];
}

export function explainMotion(p: MotionPairSummary): string {
  const ratio = p.velocity_ratio;
  if (ratio != null && ratio >= 2) {
    return `F${p.frame_a}→F${p.frame_b} 速度約提高 ${ratio.toFixed(1)} 倍（${p.provider} 區塊比對，不是 SEA-RAFT）。`;
  }
  if ((p.direction_change_deg ?? 0) >= 55) {
    return `F${p.frame_a}→F${p.frame_b} 運動方向改變 ${p.direction_change_deg?.toFixed(0)}°。`;
  }
  return `F${p.frame_a}→F${p.frame_b} 平均位移 ${p.mean_motion.toFixed(2)}。`;
}

export function explainPose(e: PoseContinuityEvent): string {
  if (e.kind === "MISSING_KEYPOINT") {
    return `${e.joint} 在 F${e.frame_b} 缺失或信心過低（姿態精簡，不是 RTMPose）。`;
  }
  if (e.kind === "POSE_DIRECTION_CHANGE") {
    return `${e.joint} 在 F${e.frame_a}→F${e.frame_b} 方向改變（姿態精簡輪廓，不是 RTMPose）。`;
  }
  return `${e.joint} 在 F${e.frame_a}→F${e.frame_b} 速度突增（v=${e.velocity.toFixed(1)}）。姿態精簡，不是 RTMPose。`;
}

/** Gaps in character/object assignments inside an analyzed range. */
export function entityStability(
  appearances: { id: string; name: string; frames: number[] }[],
  range: [number, number],
  type: Extract<ConsistencyKind, "CHARACTER_STABILITY" | "OBJECT_STABILITY">,
  preferId?: string | null,
): ConsistencyFinding[] {
  const subset = preferId ? appearances.filter((e) => e.id === preferId) : appearances;
  const findings: ConsistencyFinding[] = [];
  const [start, end] = range;
  for (const entity of subset.length ? subset : appearances) {
    const present = new Set(entity.frames.filter((n) => n >= start && n <= end));
    if (present.size === 0) continue;
    const min = Math.min(...present);
    const max = Math.max(...present);
    if (max - min < 2) continue;
    for (let n = min + 1; n < max; n += 1) {
      if (present.has(n)) continue;
      findings.push({
        type,
        score: 0.52,
        severity: "warning",
        evidence: { entity: entity.name, missing_frame: n, span: `${min}-${max}` },
        explanation:
          type === "CHARACTER_STABILITY"
            ? `角色「${entity.name}」在 F${min}–F${max} 之間的 F${n} 消失。`
            : `物件「${entity.name}」在 F${min}–F${max} 之間的 F${n} 消失。`,
        frame: n,
        related_frames: [min, n, max],
      });
    }
  }
  return findings;
}
