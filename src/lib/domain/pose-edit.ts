/** Pose editing: drag skeleton joints → PoseConstraint. Never touches pixels. */

import { fail } from "./errors.ts";
import { toNormalized } from "./visual-annotation.ts";

export type PoseJoint = { name: string; x: number; y: number; confidence: number };

export type PoseConstraint = {
  id: string;
  project_id: string;
  timeline_id: string;
  frame_id: string;
  frame_number: number;
  joint: string;
  x: number;
  y: number;
  previous_x: number;
  previous_y: number;
  keypoints: PoseJoint[];
  source: "user";
  kind: "POSE_JOINT";
  revision_id?: string | null;
};

export type PoseEditSnap = {
  op: "edit_pose";
  frameId: string;
  frameNumber: number;
  joints: PoseJoint[];
  constraints: PoseConstraintRow[];
};

export type PoseConstraintRow = {
  id: string;
  project_id: string;
  timeline_id: string;
  frame_id: string;
  frame_number: number;
  joint: string;
  x: number;
  y: number;
  previous_x: number;
  previous_y: number;
  keypoints_json: string;
  source: string;
  kind: string;
  revision_id: string | null;
};

export function isPoseEdit(raw: unknown): raw is PoseEditSnap {
  if (!raw || typeof raw !== "object") return false;
  return (raw as { op?: unknown }).op === "edit_pose";
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function normalizeJoints(
  keypoints: PoseJoint[],
  frameWidth: number,
  frameHeight: number,
): PoseJoint[] {
  return keypoints.map((k) => {
    const n = toNormalized(k.x, k.y, frameWidth, frameHeight);
    return {
      name: k.name,
      x: clamp01(n.x),
      y: clamp01(n.y),
      confidence: Number.isFinite(k.confidence) ? k.confidence : 1,
    };
  });
}

export function movePoseJoint(
  keypoints: PoseJoint[],
  name: string,
  x: number,
  y: number,
): PoseJoint[] {
  const nx = clamp01(x);
  const ny = clamp01(y);
  let found = false;
  const next = keypoints.map((k) => {
    if (k.name !== name) return k;
    found = true;
    return { ...k, x: nx, y: ny, confidence: Math.max(k.confidence, 1) };
  });
  if (!found) next.push({ name, x: nx, y: ny, confidence: 1 });
  return next;
}

export function jointByName(keypoints: PoseJoint[], name: string): PoseJoint | undefined {
  return keypoints.find((k) => k.name === name);
}

export function assertPoseJoints(raw: unknown): PoseJoint[] {
  if (!Array.isArray(raw)) fail("VALIDATION_ERROR", "keypoints required");
  const out: PoseJoint[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.name !== "string" || !r.name) continue;
    const x = Number(r.x);
    const y = Number(r.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({
      name: r.name,
      x,
      y,
      confidence: typeof r.confidence === "number" && Number.isFinite(r.confidence) ? r.confidence : 1,
    });
  }
  if (!out.length) fail("VALIDATION_ERROR", "keypoints required");
  return out;
}
