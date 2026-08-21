/**
 * AI Visual Answer: "F105 右手有問題" → seek / highlight / neighbors / trail / timeline range.
 * Never text-only.
 */

import {
  pointAnnotation,
  rangeAnnotation,
  regionAnnotation,
  type VisualAnnotation,
} from "./visual-annotation.ts";

export type VisualAnswerPart = "right_hand" | "left_hand" | "head" | "hip" | "foot" | "object" | "body";

export type VisualAnswerTrail = "right_hand" | "left_hand" | "head" | "hip" | "foot" | "object";

export type VisualAnswer = {
  frame: number;
  neighbors: [number, number];
  range: [number, number];
  part: VisualAnswerPart;
  joint: string;
  trailTarget: VisualAnswerTrail;
  category: string;
  label: string;
  overlays: ["track", "onion", "problems"];
};

const PARTS: {
  re: RegExp;
  part: VisualAnswerPart;
  joint: string;
  trail: VisualAnswerTrail;
  category: string;
  label: string;
}[] = [
  { re: /右手|right[\s_-]*hand|right[\s_-]*wrist/i, part: "right_hand", joint: "right_wrist", trail: "right_hand", category: "HAND", label: "右手" },
  { re: /左手|left[\s_-]*hand|left[\s_-]*wrist/i, part: "left_hand", joint: "left_wrist", trail: "left_hand", category: "HAND", label: "左手" },
  { re: /臉|面部|face/i, part: "head", joint: "nose", trail: "head", category: "FACE", label: "臉" },
  { re: /頭|頭部|head|nose/i, part: "head", joint: "nose", trail: "head", category: "FACE", label: "頭" },
  { re: /腳|足|foot|ankle/i, part: "foot", joint: "right_ankle", trail: "foot", category: "BODY", label: "腳" },
  { re: /髖|腰|hip/i, part: "hip", joint: "right_hip", trail: "hip", category: "BODY", label: "髖" },
  { re: /行李箱|物件|object|suitcase/i, part: "object", joint: "object", trail: "object", category: "OBJECT", label: "物件" },
];

const CATEGORY_PART: Record<string, (typeof PARTS)[number]> = {
  HAND: PARTS[0],
  CONTACT: PARTS[0],
  CONTACT_CONTINUITY: PARTS[0],
  MOTION: PARTS[0],
  MOTION_CONTINUITY: PARTS[0],
  TRACKING_CONTINUITY: PARTS[0],
  POSE: PARTS[0],
  POSE_CONTINUITY: PARTS[0],
  FACE: PARTS[2],
  CHARACTER_IDENTITY: PARTS[2],
  CHARACTER_STABILITY: PARTS[2],
  BODY: PARTS[4],
  OBJECT: PARTS[6],
  OBJECT_STABILITY: PARTS[6],
};

function parseFrameNumber(text: string): number | null {
  const m =
    text.match(/F\s*(\d+)/i) ||
    text.match(/第\s*(\d+)\s*[格幀帧張张]/) ||
    text.match(/影格\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

function parseExplicitRange(text: string): [number, number] | null {
  const m = text.match(/F\s*(\d+)\s*(?:到|至|→|-|–|—)\s*F?\s*(\d+)/i);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null;
  return a < b ? [a, b] : [b, a];
}

function neighborPair(frame: number, frameCount?: number): [number, number] {
  const prev = Math.max(0, frame - 1);
  const next = frameCount != null ? Math.min(Math.max(0, frameCount - 1), frame + 1) : frame + 1;
  return [prev, next];
}

function looksLikeAnimationCommand(text: string): boolean {
  return /多補|多补|一拍|關鍵影格|关键帧|停\s*[一二兩三四五六七八九十两\d]+\s*[格幀帧張张]/.test(text);
}

export function parseVisualAnswer(
  text: string,
  ctx?: { currentFrame?: number; frameCount?: number },
): VisualAnswer | null {
  const trimmed = text.trim();
  if (!trimmed || looksLikeAnimationCommand(trimmed)) return null;
  const row = PARTS.find((p) => p.re.test(trimmed));
  if (!row) return null;
  const mentioned = parseFrameNumber(trimmed);
  const thisFrame = /這張|這格|這一格|this\s+frame/i.test(trimmed);
  const problem = /問題|跳|歪|斷|怪|不對|壞|flicker|jumpy|broken|wrong|issue|problem/i.test(trimmed);
  if (mentioned == null && !thisFrame && !problem) return null;
  const frame = mentioned ?? ctx?.currentFrame;
  if (frame == null || !Number.isFinite(frame)) return null;
  const neighbors = neighborPair(frame, ctx?.frameCount);
  const range = parseExplicitRange(trimmed) ?? neighbors;
  return {
    frame,
    neighbors,
    range,
    part: row.part,
    joint: row.joint,
    trailTarget: row.trail,
    category: row.category,
    label: row.label,
    overlays: ["track", "onion", "problems"],
  };
}

export function visualAnswerFromProblem(
  frame: number,
  range: [number, number],
  category?: string | null,
  frameCount?: number,
): VisualAnswer {
  const row = CATEGORY_PART[(category ?? "").toUpperCase()] ?? PARTS[0];
  const neighbors = neighborPair(frame, frameCount);
  return {
    frame,
    neighbors,
    range: range[0] === range[1] ? neighbors : range,
    part: row.part,
    joint: row.joint,
    trailTarget: row.trail,
    category: row.category,
    label: row.label,
    overlays: ["track", "onion", "problems"],
  };
}

export function visualAnswerAnnotations(
  answer: VisualAnswer,
  box?: { x: number; y: number; w: number; h: number } | null,
): VisualAnnotation[] {
  const label = `${answer.label} · F${answer.frame}`;
  const out: VisualAnnotation[] = [
    rangeAnnotation(`va-rng-${answer.frame}`, answer.range[0], answer.range[1], label, {
      category: answer.category,
      frame_number: answer.frame,
      source: "ai",
      severity: "warning",
    }),
  ];
  if (box) {
    out.push(
      regionAnnotation(`va-reg-${answer.frame}`, answer.frame, box, label, {
        category: answer.category,
        source: "ai",
        severity: "warning",
      }),
    );
    out.push(
      pointAnnotation(
        `va-pt-${answer.frame}`,
        answer.frame,
        box.x + box.w / 2,
        box.y + box.h / 2,
        label,
        { category: answer.category, source: "ai", severity: "warning" },
      ),
    );
  }
  return out;
}
