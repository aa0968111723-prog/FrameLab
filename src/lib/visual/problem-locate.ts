/** Map a problem category onto a 0–1 region using pose / tracking. No fake joints. */

import { toNormalized } from "../domain/visual-annotation.ts";
import type { PoseJoint, TrackSample } from "./overlay-renderer.ts";

export type NormBox = { x: number; y: number; w: number; h: number };

const CATEGORY_JOINTS: Record<string, string[]> = {
  FACE: ["nose"],
  HAND: ["right_wrist", "left_wrist", "right_hand", "left_hand"],
  BODY: ["left_hip", "right_hip"],
  CHARACTER_IDENTITY: ["nose"],
  CHARACTER_STABILITY: ["nose"],
  POSE: ["nose"],
  POSE_CONTINUITY: ["right_wrist", "left_wrist"],
  MOTION: ["right_wrist", "right_hand"],
  MOTION_CONTINUITY: ["right_wrist"],
  CONTACT: ["right_wrist", "right_hand"],
  CONTACT_CONTINUITY: ["right_wrist"],
  OBJECT: ["object", "suitcase"],
  OBJECT_STABILITY: ["object", "suitcase"],
  TRACKING_CONTINUITY: ["right_wrist"],
};

function boxAround(nx: number, ny: number, size = 0.18): NormBox {
  const s = size;
  return {
    x: Math.max(0, nx - s / 2),
    y: Math.max(0, ny - s / 2),
    w: Math.min(1 - Math.max(0, nx - s / 2), s),
    h: Math.min(1 - Math.max(0, ny - s / 2), s),
  };
}

export function locateProblemBox(opts: {
  category?: string | null;
  frameNumber: number;
  frameWidth: number;
  frameHeight: number;
  joints?: PoseJoint[];
  tracking?: TrackSample[];
}): NormBox | null {
  const names = CATEGORY_JOINTS[(opts.category ?? "").toUpperCase()] ?? [];
  const joints = opts.joints ?? [];
  for (const name of names) {
    const j = joints.find((k) => k.name === name || k.name.includes(name));
    if (j && j.confidence > 0.15) {
      const n = toNormalized(j.x, j.y, opts.frameWidth, opts.frameHeight);
      return boxAround(n.x, n.y, name.includes("wrist") || name.includes("hand") ? 0.2 : 0.16);
    }
  }
  const tracks = (opts.tracking ?? []).filter((t) => t.frame_number === opts.frameNumber);
  for (const name of names) {
    const t = tracks.find((p) => p.name.toLowerCase().includes(name.replaceAll("_", " ")) || p.name.toLowerCase().includes(name));
    if (t) {
      const n = toNormalized(t.x, t.y, opts.frameWidth, opts.frameHeight);
      return boxAround(n.x, n.y, 0.18);
    }
  }
  if (tracks[0]) {
    const n = toNormalized(tracks[0].x, tracks[0].y, opts.frameWidth, opts.frameHeight);
    return boxAround(n.x, n.y, 0.18);
  }
  if (joints[0]) {
    const n = toNormalized(joints[0].x, joints[0].y, opts.frameWidth, opts.frameHeight);
    return boxAround(n.x, n.y, 0.18);
  }
  return null;
}

export function neighborRange(frame: number, count: number, radius = 2): [number, number] {
  const a = Math.max(0, frame - radius);
  const b = Math.min(Math.max(0, count - 1), frame + radius);
  return [a, b];
}
