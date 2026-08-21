/**
 * framelab-pose-lite — real CPU silhouette extrema, not RTMPose.
 * Keypoints are derived from moving / dark pixels. Honest, not a neural pose model.
 */

import { cropRgba } from "./lightweight-analysis.ts";
import type { RegionBox, RgbaFrame } from "./pixel-metrics.ts";

export type PoseKeypoint = {
  name: string;
  x: number;
  y: number;
  confidence: number;
};

export type PoseEstimate = {
  frame_id?: string;
  frame_number: number;
  character_id: string | null;
  provider: string;
  bbox: { x: number; y: number; w: number; h: number };
  keypoints: PoseKeypoint[];
  note: string;
};

export type PoseContinuityEvent = {
  joint: string;
  frame_a: number;
  frame_b: number;
  displacement: number;
  velocity: number;
  acceleration: number;
  kind: "POSE_VELOCITY_SPIKE" | "POSE_DIRECTION_CHANGE" | "MISSING_KEYPOINT";
};

export const POSE_BONES: [string, string][] = [
  ["nose", "left_shoulder"],
  ["nose", "right_shoulder"],
  ["left_shoulder", "right_shoulder"],
  ["left_shoulder", "left_hip"],
  ["right_shoulder", "right_hip"],
  ["left_hip", "right_hip"],
  ["left_shoulder", "left_wrist"],
  ["right_shoulder", "right_wrist"],
  ["left_hip", "left_ankle"],
  ["right_hip", "right_ankle"],
];

const JOINTS = [
  "nose",
  "left_shoulder",
  "right_shoulder",
  "left_hip",
  "right_hip",
  "left_wrist",
  "right_wrist",
  "left_ankle",
  "right_ankle",
] as const;

function lumaAt(frame: RgbaFrame, x: number, y: number) {
  const i = (y * frame.width + x) * 4;
  return 0.2126 * frame.data[i] + 0.7152 * frame.data[i + 1] + 0.0722 * frame.data[i + 2];
}

function massMask(frame: RgbaFrame, prev?: RgbaFrame | null): Uint8Array {
  const mask = new Uint8Array(frame.width * frame.height);
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const L = lumaAt(frame, x, y);
      let on = L < 90;
      if (prev && prev.width === frame.width && prev.height === frame.height) {
        const d = Math.abs(L - lumaAt(prev, x, y));
        on = on || d > 28;
      }
      mask[y * frame.width + x] = on ? 1 : 0;
    }
  }
  return mask;
}

function bboxOf(mask: Uint8Array, w: number, h: number) {
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let n = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y * w + x]) continue;
      n += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (n === 0) return { x: 0, y: 0, w: 1, h: 1, n: 0 };
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY), n };
}

function extrema(mask: Uint8Array, w: number, h: number, box: { x: number; y: number; w: number; h: number }) {
  let leftX = box.x + box.w;
  let leftY = box.y + box.h / 2;
  let rightX = box.x;
  let rightY = box.y + box.h / 2;
  let topX = box.x + box.w / 2;
  let topY = box.y + box.h;
  let botX = box.x + box.w / 2;
  let botY = box.y;
  for (let y = box.y; y < box.y + box.h; y += 1) {
    for (let x = box.x; x < box.x + box.w; x += 1) {
      if (!mask[y * w + x]) continue;
      if (x < leftX) {
        leftX = x;
        leftY = y;
      }
      if (x > rightX) {
        rightX = x;
        rightY = y;
      }
      if (y < topY) {
        topY = y;
        topX = x;
      }
      if (y > botY) {
        botY = y;
        botX = x;
      }
    }
  }
  return { leftX, leftY, rightX, rightY, topX, topY, botX, botY };
}

export function estimatePoseLite(
  frame: RgbaFrame,
  frameNumber: number,
  opts: {
    prev?: RgbaFrame | null;
    region?: RegionBox | null;
    frameId?: string;
    characterId?: string | null;
  } = {},
): PoseEstimate {
  const src = opts.region ? cropRgba(frame, opts.region) : frame;
  const prev = opts.prev
    ? opts.region
      ? cropRgba(opts.prev, opts.region)
      : opts.prev
    : null;
  const mask = massMask(src, prev);
  const box = bboxOf(mask, src.width, src.height);
  const conf = Math.max(0.15, Math.min(0.92, box.n / Math.max(1, src.width * src.height * 0.25)));
  const ext = extrema(mask, src.width, src.height, box);
  const ox = opts.region ? opts.region.x / Math.max(1, frame.width) : 0;
  const oy = opts.region ? opts.region.y / Math.max(1, frame.height) : 0;
  const sx = (opts.region ? opts.region.w : frame.width) / Math.max(1, frame.width);
  const sy = (opts.region ? opts.region.h : frame.height) / Math.max(1, frame.height);
  const nx = (x: number) => ox + (x / Math.max(1, src.width)) * sx;
  const ny = (y: number) => oy + (y / Math.max(1, src.height)) * sy;
  const cx = box.x + box.w / 2;
  const keypoints: PoseKeypoint[] = [
    { name: "nose", x: nx(ext.topX), y: ny(ext.topY), confidence: conf },
    {
      name: "left_shoulder",
      x: nx(box.x + box.w * 0.28),
      y: ny(box.y + box.h * 0.28),
      confidence: conf * 0.8,
    },
    {
      name: "right_shoulder",
      x: nx(box.x + box.w * 0.72),
      y: ny(box.y + box.h * 0.28),
      confidence: conf * 0.8,
    },
    {
      name: "left_hip",
      x: nx(box.x + box.w * 0.32),
      y: ny(box.y + box.h * 0.62),
      confidence: conf * 0.75,
    },
    {
      name: "right_hip",
      x: nx(box.x + box.w * 0.68),
      y: ny(box.y + box.h * 0.62),
      confidence: conf * 0.75,
    },
    { name: "left_wrist", x: nx(ext.leftX), y: ny(ext.leftY), confidence: conf },
    { name: "right_wrist", x: nx(ext.rightX), y: ny(ext.rightY), confidence: conf },
    {
      name: "left_ankle",
      x: nx(box.x + box.w * 0.35),
      y: ny(ext.botY),
      confidence: conf * 0.7,
    },
    {
      name: "right_ankle",
      x: nx(box.x + box.w * 0.65),
      y: ny(ext.botY),
      confidence: conf * 0.7,
    },
  ];
  void cx;
  void JOINTS;
  return {
    frame_id: opts.frameId,
    frame_number: frameNumber,
    character_id: opts.characterId ?? null,
    provider: "framelab-pose-lite",
    bbox: {
      x: nx(box.x),
      y: ny(box.y),
      w: (box.w / Math.max(1, src.width)) * sx,
      h: (box.h / Math.max(1, src.height)) * sy,
    },
    keypoints: keypoints.map((k) => ({
      ...k,
      x: round4(Math.min(1, Math.max(0, k.x))),
      y: round4(Math.min(1, Math.max(0, k.y))),
      confidence: round4(k.confidence),
    })),
    note: "framelab-pose-lite silhouette extrema from pixel mass / frame difference. Not RTMPose.",
  };
}

export function poseContinuity(
  poses: PoseEstimate[],
  fps = 24,
): PoseContinuityEvent[] {
  const events: PoseContinuityEvent[] = [];
  const byJoint = (p: PoseEstimate, name: string) => p.keypoints.find((k) => k.name === name);
  for (let i = 1; i < poses.length; i += 1) {
    const a = poses[i - 1];
    const b = poses[i];
    const prev = i > 1 ? poses[i - 2] : null;
    for (const name of ["right_wrist", "left_wrist", "nose", "right_ankle", "left_ankle"]) {
      const pa = byJoint(a, name);
      const pb = byJoint(b, name);
      if (!pa || !pb || pa.confidence < 0.2 || pb.confidence < 0.2) {
        if (pa && (!pb || pb.confidence < 0.2)) {
          events.push({
            joint: name,
            frame_a: a.frame_number,
            frame_b: b.frame_number,
            displacement: 0,
            velocity: 0,
            acceleration: 0,
            kind: "MISSING_KEYPOINT",
          });
        }
        continue;
      }
      const disp = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      const velocity = disp * fps;
      let prevVel = 0;
      let prevDx = 0;
      let prevDy = 0;
      if (prev) {
        const pp = byJoint(prev, name);
        if (pp) {
          prevDx = pa.x - pp.x;
          prevDy = pa.y - pp.y;
          prevVel = Math.hypot(prevDx, prevDy) * fps;
        }
      }
      const acceleration = velocity - prevVel;
      const ratio = prevVel > 0.4 ? velocity / prevVel : 1;
      if (ratio >= 2.2 && velocity > 1.2) {
        events.push({
          joint: name,
          frame_a: a.frame_number,
          frame_b: b.frame_number,
          displacement: round4(disp),
          velocity: round4(velocity),
          acceleration: round4(acceleration),
          kind: "POSE_VELOCITY_SPIKE",
        });
      }
      const magPrev = Math.hypot(prevDx, prevDy);
      const magNow = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      if (magPrev > 0.012 && magNow > 0.012) {
        const dot = Math.max(
          -1,
          Math.min(1, (prevDx * (pb.x - pa.x) + prevDy * (pb.y - pa.y)) / (magPrev * magNow)),
        );
        const deg = (Math.acos(dot) * 180) / Math.PI;
        if (deg >= 70) {
          events.push({
            joint: name,
            frame_a: a.frame_number,
            frame_b: b.frame_number,
            displacement: round4(disp),
            velocity: round4(velocity),
            acceleration: round4(acceleration),
            kind: "POSE_DIRECTION_CHANGE",
          });
        }
      }
    }
  }
  return events;
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}
