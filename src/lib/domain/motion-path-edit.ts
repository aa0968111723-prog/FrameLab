/** Motion path editing: drag one trail control point → MotionConstraint. Never touches pixels or keyframes. */

import { fail } from "./errors.ts";

export type MotionConstraintRow = {
  id: string;
  project_id: string;
  timeline_id: string;
  frame_id: string | null;
  frame_number: number;
  name: string;
  x: number;
  y: number;
  previous_x: number;
  previous_y: number;
  source: string;
  kind: string;
  revision_id: string | null;
};

export type MotionEditSnap = {
  op: "edit_motion_path";
  projectId: string;
  timelineId: string;
  frameId: string | null;
  frameNumber: number;
  name: string;
  pointId: string;
  x: number;
  y: number;
  present: boolean;
  constraints: MotionConstraintRow[];
};

export function isMotionEdit(raw: unknown): raw is MotionEditSnap {
  if (!raw || typeof raw !== "object") return false;
  return (raw as { op?: unknown }).op === "edit_motion_path";
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function motionPixels(
  nx: number,
  ny: number,
  frameWidth: number,
  frameHeight: number,
): { x: number; y: number } {
  const x = clamp01(nx);
  const y = clamp01(ny);
  return {
    x: Math.round(x * Math.max(1, frameWidth)),
    y: Math.round(y * Math.max(1, frameHeight)),
  };
}

export function assertTrailName(name: string): string {
  const n = name.trim();
  if (!n) fail("VALIDATION_ERROR", "name required");
  return n;
}
