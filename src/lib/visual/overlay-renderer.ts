/**
 * Unified OverlayRenderer. Pose / motion / tracking / problems / AI pointers
 * all share one ViewportTransform so zoom/pan never misaligns overlays.
 */

import { POSE_BONES } from "../domain/pose-lite.ts";
import type { VisualAnnotation } from "../domain/visual-annotation.ts";
import { categoryLabel, toNormalized } from "../domain/visual-annotation.ts";
import { frameToView, normToView, type ViewportTransform } from "./viewport.ts";
import type { TrailTarget } from "./workspace-mode.ts";
import { trailKeypointNames } from "./workspace-mode.ts";

export type PoseJoint = { name: string; x: number; y: number; confidence: number };

export type TrackSample = {
  name: string;
  x: number;
  y: number;
  frame_number: number;
  status?: string;
  score?: number;
};

export type OverlayDrawInput = {
  vt: ViewportTransform;
  currentFrame: number;
  pose?: { keypoints: PoseJoint[] } | null;
  posePrev?: { keypoints: PoseJoint[] } | null;
  poseNext?: { keypoints: PoseJoint[] } | null;
  selectedJoint?: string | null;
  tracking: TrackSample[];
  trailTarget?: TrailTarget;
  customTrail?: string | null;
  annotations: VisualAnnotation[];
  problemRegions?: { x: number; y: number; w: number; h: number; label: string; severity: string }[];
  regionBox?: { x: number; y: number; w: number; h: number } | null;
  maskNorm?: { x: number; y: number; w: number; h: number } | null;
  pointer?: { x: number; y: number; label: string } | null;
  contact?: { ax: number; ay: number; bx: number; by: number; broken: boolean; label: string } | null;
  layers: {
    pose?: boolean;
    poseGhost?: boolean;
    motionPath?: boolean;
    tracking?: boolean;
    problems?: boolean;
    mask?: boolean;
    annotations?: boolean;
    contact?: boolean;
  };
};

const BONE_COLOR = "rgba(200, 204, 212, 0.85)";
const BONE_DIM = "rgba(200, 204, 212, 0.22)";
const GHOST_PREV = "rgba(120, 170, 210, 0.55)";
const GHOST_NEXT = "rgba(210, 160, 120, 0.5)";
const PROBLEM = "rgba(196, 165, 116, 0.95)";
const DANGER = "rgba(196, 120, 120, 0.95)";

function derivedJoints(kps: PoseJoint[]): PoseJoint[] {
  const get = (n: string) => kps.find((k) => k.name === n);
  const mid = (a?: PoseJoint, b?: PoseJoint, name?: string): PoseJoint | null => {
    if (!a || !b || !name) return null;
    return {
      name,
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      confidence: Math.min(a.confidence, b.confidence),
    };
  };
  const extra = [
    mid(get("left_shoulder"), get("left_wrist"), "left_elbow"),
    mid(get("right_shoulder"), get("right_wrist"), "right_elbow"),
    mid(get("left_hip"), get("left_ankle"), "left_knee"),
    mid(get("right_hip"), get("right_ankle"), "right_knee"),
  ].filter((j): j is PoseJoint => Boolean(j) && !get(j!.name));
  return [...kps, ...extra];
}

const BONES: [string, string][] = [
  ...POSE_BONES,
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"],
  ["right_hip", "right_knee"],
  ["right_knee", "right_ankle"],
];

const CHAINS: Record<string, string[]> = {
  right_wrist: ["right_shoulder", "right_elbow", "right_wrist"],
  left_wrist: ["left_shoulder", "left_elbow", "left_wrist"],
  right_ankle: ["right_hip", "right_knee", "right_ankle"],
  left_ankle: ["left_hip", "left_knee", "left_ankle"],
  nose: ["nose", "left_shoulder", "right_shoulder"],
  head: ["nose", "left_shoulder", "right_shoulder"],
};

export function poseScreenPoints(
  vt: ViewportTransform,
  keypoints: PoseJoint[],
): Map<string, { x: number; y: number; confidence: number }> {
  const map = new Map<string, { x: number; y: number; confidence: number }>();
  for (const k of derivedJoints(keypoints)) {
    const n = toNormalized(k.x, k.y, vt.frameWidth, vt.frameHeight);
    const p = normToView(vt, n.x, n.y);
    map.set(k.name, { ...p, confidence: k.confidence });
  }
  return map;
}

export function drawPoseSkeleton(
  ctx: CanvasRenderingContext2D,
  vt: ViewportTransform,
  keypoints: PoseJoint[],
  opts: { ghost?: "prev" | "next" | null; selected?: string | null; dimUnselected?: boolean } = {},
) {
  const pts = poseScreenPoints(vt, keypoints);
  const chain = opts.selected ? new Set(CHAINS[opts.selected] ?? [opts.selected]) : null;
  const stroke =
    opts.ghost === "prev" ? GHOST_PREV : opts.ghost === "next" ? GHOST_NEXT : BONE_COLOR;
  ctx.save();
  ctx.lineWidth = opts.ghost ? 1.2 : 1.6;
  ctx.lineCap = "round";
  for (const [a, b] of BONES) {
    const pa = pts.get(a);
    const pb = pts.get(b);
    if (!pa || !pb) continue;
    const hot = !chain || chain.has(a) || chain.has(b);
    ctx.strokeStyle = hot ? stroke : BONE_DIM;
    ctx.globalAlpha = hot ? 1 : opts.dimUnselected ? 0.35 : 1;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
  for (const [name, p] of pts) {
    const hot = !chain || chain.has(name);
    ctx.fillStyle = hot ? stroke : BONE_DIM;
    ctx.globalAlpha = hot ? 1 : 0.3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, hot && opts.selected === name ? 4.5 : 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function motionPathPoints(
  tracking: TrackSample[],
  vt: ViewportTransform,
  name: string,
): { x: number; y: number; frame: number; problem: boolean; status: string }[] {
  return tracking
    .filter((t) => t.name === name)
    .sort((a, b) => a.frame_number - b.frame_number)
    .map((t) => {
      const n = toNormalized(t.x, t.y, vt.frameWidth, vt.frameHeight);
      const p = normToView(vt, n.x, n.y);
      const status = String(t.status ?? "visible").toLowerCase();
      return {
        x: p.x,
        y: p.y,
        frame: t.frame_number,
        status,
        problem: status === "lost" || status === "occluded" || (typeof t.score === "number" && t.score < 0.35),
      };
    });
}

const STATUS_COLOR: Record<string, string> = {
  visible: "rgba(142, 160, 181, 0.95)",
  recovered: "rgba(120, 180, 140, 0.95)",
  occluded: "rgba(196, 165, 116, 0.95)",
  lost: DANGER,
};

export function drawMotionPath(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number; frame: number; problem: boolean; status?: string }[],
  currentFrame: number,
) {
  if (points.length < 2) return;
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const st = (b.status ?? (b.problem ? "lost" : "visible")).toLowerCase();
    ctx.strokeStyle = STATUS_COLOR[st] ?? STATUS_COLOR.visible;
    ctx.setLineDash(st === "occluded" ? [4, 3] : st === "lost" ? [2, 3] : []);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const p of points) {
    const st = (p.status ?? (p.problem ? "lost" : "visible")).toLowerCase();
    ctx.fillStyle = p.frame === currentFrame ? "#f4f4f5" : STATUS_COLOR[st] ?? STATUS_COLOR.visible;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.frame === currentFrame ? 3.8 : 2.4, 0, Math.PI * 2);
    ctx.fill();
    if (st === "lost") {
      ctx.fillStyle = DANGER;
      ctx.font = "10px sans-serif";
      ctx.fillText("×", p.x + 5, p.y - 5);
    } else if (st === "occluded") {
      ctx.fillStyle = STATUS_COLOR.occluded;
      ctx.font = "10px sans-serif";
      ctx.fillText("◌", p.x + 5, p.y - 5);
    } else if (st === "recovered") {
      ctx.fillStyle = STATUS_COLOR.recovered;
      ctx.font = "10px sans-serif";
      ctx.fillText("↺", p.x + 5, p.y - 5);
    }
  }
  ctx.restore();
}

export type FlowCell = { x: number; y: number; dx: number; dy: number; mag: number };

export function drawSampledFlow(
  ctx: CanvasRenderingContext2D,
  vt: ViewportTransform,
  grid: FlowCell[],
) {
  if (!grid.length) return;
  ctx.save();
  ctx.lineWidth = 1.15;
  ctx.lineCap = "round";
  for (const c of grid) {
    const a = frameToView(vt, c.x, c.y);
    const b = frameToView(vt, c.x + c.dx, c.y + c.dy);
    const t = Math.min(1, c.mag / 18);
    ctx.strokeStyle = `rgba(180, 210, 230, ${0.45 + 0.5 * t})`;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - 5 * Math.cos(ang - 0.45), b.y - 5 * Math.sin(ang - 0.45));
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - 5 * Math.cos(ang + 0.45), b.y - 5 * Math.sin(ang + 0.45));
    ctx.stroke();
  }
  ctx.restore();
}

export function drawFlowPaths(
  ctx: CanvasRenderingContext2D,
  vt: ViewportTransform,
  paths: { x: number; y: number }[][],
) {
  if (!paths.length) return;
  ctx.save();
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(232, 196, 120, 0.9)";
  ctx.fillStyle = "rgba(244, 244, 245, 0.95)";
  for (const path of paths) {
    if (path.length < 2) continue;
    ctx.beginPath();
    const first = frameToView(vt, path[0]!.x, path[0]!.y);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < path.length; i += 1) {
      const p = frameToView(vt, path[i]!.x, path[i]!.y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    const last = frameToView(vt, path[path.length - 1]!.x, path[path.length - 1]!.y);
    ctx.beginPath();
    ctx.arc(last.x, last.y, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Onion motion trail: only nearby frames, fading. */
export function drawOnionTrail(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number; frame: number; problem: boolean }[],
  currentFrame: number,
  radius = 3,
) {
  const local = points.filter((p) => Math.abs(p.frame - currentFrame) <= radius);
  if (local.length === 0) return;
  ctx.save();
  ctx.lineWidth = 1.25;
  ctx.lineJoin = "round";
  for (let i = 1; i < local.length; i += 1) {
    const a = local[i - 1];
    const b = local[i];
    ctx.globalAlpha = 0.35 + 0.45 * (1 - Math.abs(b.frame - currentFrame) / Math.max(1, radius));
    ctx.strokeStyle = a.problem || b.problem ? DANGER : "rgba(200,204,212,0.85)";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (const p of local) {
    const hot = p.frame === currentFrame;
    ctx.globalAlpha = hot ? 1 : 0.45 + 0.4 * (1 - Math.abs(p.frame - currentFrame) / Math.max(1, radius));
    ctx.fillStyle = p.problem ? DANGER : hot ? "#f4f4f5" : "rgba(200,204,212,0.9)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, hot ? 4 : 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function pickTrailName(
  tracking: TrackSample[],
  target: TrailTarget | undefined,
  custom?: string | null,
): string | null {
  if (custom) return custom;
  if (!target || target === "custom") {
    const names = [...new Set(tracking.map((t) => t.name))];
    return names[0] ?? null;
  }
  const aliases: Record<string, string[]> = {
    head: ["head", "nose", "face"],
    left_hand: ["left_hand", "left_wrist", "hand_l"],
    right_hand: ["right_hand", "right_wrist", "hand", "hand_r"],
    hip: ["hip", "hips"],
    foot: ["foot", "left_ankle", "right_ankle"],
    object: ["object", "suitcase", "prop"],
  };
  const want = aliases[target] ?? [];
  const names = [...new Set(tracking.map((t) => t.name))];
  return names.find((n) => want.some((w) => n.toLowerCase().includes(w))) ?? names[0] ?? null;
}

export function drawRegionOutline(
  ctx: CanvasRenderingContext2D,
  vt: ViewportTransform,
  box: { x: number; y: number; w: number; h: number },
  opts: { normalized?: boolean; label?: string; tone?: string; fill?: boolean } = {},
) {
  const p = opts.normalized
    ? normToView(vt, box.x, box.y)
    : frameToView(vt, box.x, box.y);
  const w = (opts.normalized ? box.w * vt.frameWidth : box.w) * vt.scale;
  const h = (opts.normalized ? box.h * vt.frameHeight : box.h) * vt.scale;
  ctx.save();
  if (opts.fill) {
    ctx.fillStyle = "rgba(196, 165, 116, 0.12)";
    ctx.fillRect(p.x, p.y, w, h);
  }
  ctx.strokeStyle = opts.tone ?? "rgba(200, 170, 110, 0.95)";
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1.25;
  ctx.strokeRect(p.x, p.y, w, h);
  if (opts.label) {
    ctx.setLineDash([]);
    ctx.font = "11px sans-serif";
    const tw = ctx.measureText(opts.label).width + 10;
    ctx.fillStyle = "rgba(18,18,20,0.86)";
    ctx.fillRect(p.x, Math.max(0, p.y - 18), tw, 16);
    ctx.fillStyle = "#f4f4f5";
    ctx.fillText(opts.label, p.x + 5, Math.max(12, p.y - 6));
  }
  ctx.restore();
}

export function drawAiPointer(
  ctx: CanvasRenderingContext2D,
  vt: ViewportTransform,
  nx: number,
  ny: number,
  label: string,
  pulse = 0,
) {
  const p = normToView(vt, nx, ny);
  const r = 10 + Math.sin(pulse) * 2;
  ctx.save();
  ctx.strokeStyle = "rgba(232, 217, 184, 0.85)";
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - 22);
  ctx.lineTo(p.x - 6, p.y - 8);
  ctx.lineTo(p.x + 6, p.y - 8);
  ctx.closePath();
  ctx.fillStyle = "rgba(232, 217, 184, 0.95)";
  ctx.fill();
  ctx.font = "11px sans-serif";
  const text = label;
  const tw = ctx.measureText(text).width + 12;
  ctx.fillStyle = "rgba(18,18,20,0.9)";
  ctx.fillRect(p.x + 8, p.y - 28, tw, 18);
  ctx.fillStyle = "#f4f4f5";
  ctx.fillText(text, p.x + 14, p.y - 15);
  ctx.restore();
}

export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  vt: ViewportTransform,
  annotations: VisualAnnotation[],
  currentFrame: number,
  pulse = 0,
) {
  for (const a of annotations) {
    if (a.type === "RANGE") continue;
    if (a.frame_number !== currentFrame && a.type !== "PATH") continue;
    const sev = a.severity === "error" || a.severity === "critical" ? DANGER : PROBLEM;
    if (a.type === "POINT" && a.coordinates.length >= 2) {
      if (a.source === "ai") {
        drawAiPointer(ctx, vt, a.coordinates[0], a.coordinates[1], a.label, pulse);
      } else {
        const p = normToView(vt, a.coordinates[0], a.coordinates[1]);
        ctx.save();
        ctx.fillStyle = sev;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 14);
        ctx.lineTo(p.x - 5, p.y - 4);
        ctx.lineTo(p.x + 5, p.y - 4);
        ctx.closePath();
        ctx.fill();
        ctx.font = "11px sans-serif";
        ctx.fillStyle = "#f4f4f5";
        ctx.fillText(a.label, p.x + 8, p.y - 6);
        ctx.restore();
      }
    }
    if (a.type === "REGION" && a.coordinates.length >= 4) {
      drawRegionOutline(
        ctx,
        vt,
        {
          x: a.coordinates[0],
          y: a.coordinates[1],
          w: a.coordinates[2],
          h: a.coordinates[3],
        },
        { normalized: true, label: `! ${a.label}`, tone: sev, fill: true },
      );
    }
    if (a.type === "LABEL" && a.coordinates.length >= 2) {
      const p = normToView(vt, a.coordinates[0], a.coordinates[1]);
      ctx.save();
      ctx.font = "11px sans-serif";
      ctx.fillStyle = "rgba(18,18,20,0.86)";
      const tw = ctx.measureText(a.label).width + 12;
      ctx.fillRect(p.x, p.y, tw, 18);
      ctx.fillStyle = "#f4f4f5";
      ctx.fillText(a.label, p.x + 6, p.y + 13);
      ctx.restore();
    }
    if (a.type === "PATH" && a.coordinates.length >= 4) {
      ctx.save();
      ctx.strokeStyle = sev;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i + 1 < a.coordinates.length; i += 2) {
        const p = normToView(vt, a.coordinates[i], a.coordinates[i + 1]);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }
}

export function drawContact(
  ctx: CanvasRenderingContext2D,
  vt: ViewportTransform,
  contact: { ax: number; ay: number; bx: number; by: number; broken: boolean; label: string },
) {
  const a = frameToView(vt, contact.ax, contact.ay);
  const b = frameToView(vt, contact.bx, contact.by);
  ctx.save();
  ctx.strokeStyle = contact.broken ? DANGER : "rgba(155, 176, 160, 0.7)";
  ctx.lineWidth = 1.3;
  ctx.setLineDash(contact.broken ? [4, 4] : []);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = contact.broken ? DANGER : "rgba(155, 176, 160, 0.95)";
  ctx.beginPath();
  ctx.arc(a.x, a.y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
  ctx.fill();
  if (contact.broken) {
    ctx.font = "11px sans-serif";
    ctx.fillText(`! ${contact.label}`, (a.x + b.x) / 2 + 6, (a.y + b.y) / 2);
  }
  ctx.restore();
}

export function drawProblemBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
): { x: number; y: number; w: number; h: number } {
  ctx.save();
  ctx.font = "11px sans-serif";
  const text = `! ${label}`;
  const tw = ctx.measureText(text).width + 14;
  const box = { x, y, w: tw, h: 20 };
  ctx.fillStyle = "rgba(18,18,20,0.9)";
  ctx.strokeStyle = PROBLEM;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, tw, 20, 4);
  else ctx.rect(x, y, tw, 20);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#e8d9b8";
  ctx.fillText(text, x + 7, y + 14);
  ctx.restore();
  return box;
}

export function inferContact(
  tracking: TrackSample[],
  currentFrame: number,
  frameWidth: number,
  frameHeight: number,
): { ax: number; ay: number; bx: number; by: number; broken: boolean; label: string } | null {
  const here = tracking.filter((t) => t.frame_number === currentFrame);
  if (here.length < 2) return null;
  const hand = here.find((t) => /hand|wrist/i.test(t.name)) ?? here[0];
  const obj = here.find((t) => t.name !== hand.name && /suit|obj|bag|box|prop/i.test(t.name)) ?? here.find((t) => t.name !== hand.name);
  if (!obj) return null;
  const a = toNormalized(hand.x, hand.y, frameWidth, frameHeight);
  const b = toNormalized(obj.x, obj.y, frameWidth, frameHeight);
  const dx = (a.x - b.x) * frameWidth;
  const dy = (a.y - b.y) * frameHeight;
  const dist = Math.hypot(dx, dy);
  const broken = hand.status === "lost" || obj.status === "lost" || dist > Math.max(frameWidth, frameHeight) * 0.35;
  return {
    ax: a.x * frameWidth,
    ay: a.y * frameHeight,
    bx: b.x * frameWidth,
    by: b.y * frameHeight,
    broken,
    label: broken ? `接觸中斷 F${currentFrame}` : `${hand.name} ↔ ${obj.name}`,
  };
}

export function hitAnnotation(
  vt: ViewportTransform,
  annotations: VisualAnnotation[],
  currentFrame: number,
  px: number,
  py: number,
): VisualAnnotation | null {
  for (const a of annotations) {
    if (a.type === "RANGE") continue;
    if (a.frame_number !== currentFrame) continue;
    if (a.type === "POINT" && a.coordinates.length >= 2) {
      const p = normToView(vt, a.coordinates[0], a.coordinates[1]);
      if (Math.hypot(p.x - px, p.y - py) < 18) return a;
    }
    if (a.type === "REGION" && a.coordinates.length >= 4) {
      const p = normToView(vt, a.coordinates[0], a.coordinates[1]);
      const w = a.coordinates[2] * vt.frameWidth * vt.scale;
      const h = a.coordinates[3] * vt.frameHeight * vt.scale;
      if (px >= p.x && py >= p.y && px <= p.x + w && py <= p.y + h) return a;
    }
  }
  return null;
}

export function focusRectForAnnotation(
  vt: ViewportTransform,
  a: VisualAnnotation,
): { nx: number; ny: number; nw: number; nh: number } | null {
  if (a.type === "REGION" && a.coordinates.length >= 4) {
    return { nx: a.coordinates[0], ny: a.coordinates[1], nw: a.coordinates[2], nh: a.coordinates[3] };
  }
  if (a.type === "POINT" && a.coordinates.length >= 2) {
    return { nx: Math.max(0, a.coordinates[0] - 0.12), ny: Math.max(0, a.coordinates[1] - 0.12), nw: 0.24, nh: 0.24 };
  }
  return null;
}

export function hitProblemBubble(
  box: { x: number; y: number; w: number; h: number } | null,
  px: number,
  py: number,
): boolean {
  if (!box) return false;
  return px >= box.x && py >= box.y && px <= box.x + box.w && py <= box.y + box.h;
}

export { categoryLabel, trailKeypointNames };
