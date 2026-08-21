/** Transition complexity from real metrics — never random. */

export type TransitionComplexity = "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

export type TransitionFeatures = {
  mean_motion: number;
  pose_displacement: number;
  object_displacement: number;
  visual_similarity: number;
  character_count: number;
  contact_count: number;
  camera_motion: number;
  occlusion: boolean;
};

export type TransitionAnalysis = {
  complexity: TransitionComplexity;
  score: number;
  features: TransitionFeatures;
  reasons: string[];
  suggest_breakdown: boolean;
};

export function scoreTransition(f: TransitionFeatures): TransitionAnalysis {
  const motion = Math.min(1, f.mean_motion / 18);
  const pose = Math.min(1, f.pose_displacement / 0.45);
  const objects = Math.min(1, f.object_displacement / 0.4);
  const appearance = 1 - Math.min(1, Math.max(0, f.visual_similarity));
  const camera = Math.min(1, f.camera_motion / 8);
  const crowd = Math.min(1, f.character_count / 4);
  const score = Math.min(
    1,
    motion * 0.28 + pose * 0.28 + objects * 0.12 + appearance * 0.14 + camera * 0.1 + crowd * 0.08,
  );
  const reasons: string[] = [];
  if (motion >= 0.45) reasons.push(`像素運動 ${f.mean_motion.toFixed(2)}`);
  if (pose >= 0.45) reasons.push(`姿態位移 ${f.pose_displacement.toFixed(2)}`);
  if (appearance >= 0.4) reasons.push(`外觀變化 ${(appearance * 100).toFixed(0)}%`);
  if (f.occlusion) reasons.push("可能有遮擋");
  if (f.contact_count > 0) reasons.push(`${f.contact_count} 組接觸`);
  let complexity: TransitionComplexity = "LOW";
  if (score >= 0.78 || (pose >= 0.85 && f.occlusion)) complexity = "VERY_HIGH";
  else if (score >= 0.55) complexity = "HIGH";
  else if (score >= 0.28) complexity = "MEDIUM";
  const suggest_breakdown =
    complexity === "VERY_HIGH" ||
    pose >= 0.7 ||
    (f.contact_count > 0 && pose >= 0.45) ||
    f.occlusion;
  return { complexity, score: Math.round(score * 1000) / 1000, features: f, reasons, suggest_breakdown };
}

export function midpointBreakdown(start: number, end: number): number {
  return Math.round((start + end) / 2);
}
