/**
 * Deterministic NL → AnimationCommand.
 * Never execute here. UI must show a confirmation card first.
 */

import { EXPOSURE_LABEL } from "./exposure.ts";

export const ANIMATION_COMMAND_KINDS = [
  "add_inbetweens",
  "hold_frame",
  "set_keyframe",
  "set_exposure",
] as const;

export type AnimationCommandKind = (typeof ANIMATION_COMMAND_KINDS)[number];

export type AnimationCommandContext = {
  currentFrame: number;
  currentFrameId?: string | null;
  timelineId?: string | null;
  selectedRange?: [number, number] | null;
};

export type AnimationCommandArgs = {
  timelineId?: string;
  frameId?: string;
  frameNumber?: number;
  startFrame?: number;
  endFrame?: number;
  frameA?: number;
  frameB?: number;
  count?: number;
  exposure?: number;
  promoteKeys?: boolean;
  confirmed?: boolean;
};

export type AnimationCommand = {
  kind: AnimationCommandKind;
  tool: string;
  args: AnimationCommandArgs;
  title: string;
  summary: string;
  details: string[];
  frame: number;
  start?: number;
  end?: number;
  count?: number;
  exposure?: number;
  needsConfirm: true;
};

const ZH_NUM: Record<string, number> = {
  一: 1,
  二: 2,
  兩: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

export function parseCountToken(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  if (t in ZH_NUM) return ZH_NUM[t];
  return null;
}

function parseRange(text: string): [number, number] | null {
  const m = text.match(/F\s*(\d+)\s*(?:到|至|→|->|-|–|—)\s*F?\s*(\d+)/i);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null;
  return a < b ? [a, b] : [b, a];
}

function parseFrameRef(text: string, fallback: number): number {
  const m = text.match(/F\s*(\d+)/i);
  if (m) return Number(m[1]);
  return fallback;
}

function thisFrame(text: string): boolean {
  return /這張|這格|這一格|這幀|当前|當前|this\s+frame/i.test(text);
}

function withFrameArgs(ctx: AnimationCommandContext, frame: number): AnimationCommandArgs {
  const args: AnimationCommandArgs = { frameNumber: frame };
  if (ctx.timelineId) args.timelineId = ctx.timelineId;
  if (ctx.currentFrameId && frame === ctx.currentFrame) args.frameId = ctx.currentFrameId;
  return args;
}

function exposureCommand(text: string, ctx: AnimationCommandContext): AnimationCommand | null {
  const ones = text.match(/一拍\s*([一二兩三四五1234])/) || text.match(/on\s*(ones|twos|threes|fours)/i);
  if (!ones && !/改成一拍|設成一拍|改一拍|曝光/i.test(text)) return null;
  let exposure: number | null = null;
  if (ones) {
    const token = ones[1]!;
    if (/ones/i.test(token)) exposure = 1;
    else if (/twos/i.test(token)) exposure = 2;
    else if (/threes/i.test(token)) exposure = 3;
    else if (/fours/i.test(token)) exposure = 4;
    else exposure = parseCountToken(token);
  }
  if (exposure == null) return null;
  if (exposure < 1 || exposure > 4) return null;
  if (/補|补|中間|中间/.test(text) && /F\s*\d+\s*(?:到|至)/i.test(text)) return null;
  const frame = parseFrameRef(text, ctx.currentFrame);
  const label = EXPOSURE_LABEL[exposure] ?? `一拍${exposure}`;
  return {
    kind: "set_exposure",
    tool: "set_frame_exposure",
    args: { ...withFrameArgs(ctx, frame), exposure },
    title: `改成${label}`,
    summary: `將 F${frame} 設成${label}（曝光 ${exposure}）。不會複製圖片。`,
    details: [`影格 F${frame}`, `曝光 ${exposure} · ${label}`],
    frame,
    exposure,
    needsConfirm: true,
  };
}

function keyframeCommand(text: string, ctx: AnimationCommandContext): AnimationCommand | null {
  if (!/設成關鍵|設為關鍵|標成關鍵|標為關鍵|改成關鍵|變成關鍵|設成 KEY|設為 KEY|create\s+keyframe|make\s+(this\s+)?key/i.test(text)) {
    return null;
  }
  const frame = thisFrame(text) || !/F\s*\d+/i.test(text) ? ctx.currentFrame : parseFrameRef(text, ctx.currentFrame);
  return {
    kind: "set_keyframe",
    tool: "create_keyframe",
    args: withFrameArgs(ctx, frame),
    title: "設成關鍵影格",
    summary: `將 F${frame} 標成關鍵影格。`,
    details: [`影格 F${frame}`, "類型 關鍵影格"],
    frame,
    needsConfirm: true,
  };
}

function holdCommand(text: string, ctx: AnimationCommandContext): AnimationCommand | null {
  const m =
    text.match(/F\s*(\d+)\s*停\s*([一二兩三四五六七八九十两\d]+)\s*[格幀帧張张]/) ||
    text.match(/(?:這張|這格|這一格)?\s*停\s*([一二兩三四五六七八九十两\d]+)\s*[格幀帧張张]/);
  if (!m) return null;
  const hasFrame = m.length === 3 && /^\d+$/.test(m[1] ?? "");
  const frame = hasFrame ? Number(m[1]) : parseFrameRef(text, ctx.currentFrame);
  const ticks = parseCountToken(hasFrame ? m[2] : m[1]);
  if (ticks == null || ticks < 1) return null;
  const exposure = Math.max(2, Math.min(4, ticks));
  return {
    kind: "hold_frame",
    tool: "hold_frame",
    args: { ...withFrameArgs(ctx, frame), exposure },
    title: `F${frame} 停 ${exposure} 格`,
    summary: `將 F${frame} 設為停格，曝光 ${exposure}（${EXPOSURE_LABEL[exposure] ?? `一拍${exposure}`}）。不會複製圖片。`,
    details: [`影格 F${frame}`, `停 ${exposure} 格`, "類型 停留格"],
    frame,
    exposure,
    count: exposure,
    needsConfirm: true,
  };
}

function inbetweenCommand(text: string, ctx: AnimationCommandContext): AnimationCommand | null {
  const countMatch =
    text.match(/多\s*補\s*([一二兩三四五六七八九十两\d]+)\s*[張张幀帧格]?/) ||
    text.match(/補\s*([一二兩三四五六七八九十两\d]+)\s*[張张幀帧格]/) ||
    text.match(/补\s*([一二兩三四五六七八九十两\d]+)\s*[张张帧帧格]/) ||
    text.match(/加\s*([一二兩三四五六七八九十两\d]+)\s*[張张幀帧格]/) ||
    text.match(/(\d+)\s*(?:inbetweens?|frames?)/i);
  if (!countMatch && !/中間.*補|中间.*补|多補|多补/.test(text)) return null;
  if (/停\s*[一二兩三四五六七八九十两\d]+\s*[格幀]/i.test(text) && !/補|补/.test(text)) return null;
  if (/設成關鍵|設為關鍵|一拍/.test(text) && !/補|补/.test(text)) return null;
  const count = parseCountToken(countMatch?.[1] ?? null);
  if (count == null || count < 1) return null;
  const range = parseRange(text) ?? ctx.selectedRange ?? null;
  if (!range) return null;
  const [start, end] = range;
  return {
    kind: "add_inbetweens",
    tool: "generate_inbetweens",
    args: {
      timelineId: ctx.timelineId ?? undefined,
      startFrame: start,
      endFrame: end,
      frameA: start,
      frameB: end,
      count,
      promoteKeys: true,
      confirmed: false,
    },
    title: `F${start} 到 F${end} 多補 ${count} 張`,
    summary: `在 F${start}–F${end} 產生 ${count} 張中間影格候選。確認後才會跑；不會直接寫入時間軸。`,
    details: [`範圍 F${start} → F${end}`, `補 ${count} 張`, "結果是候選，需再接受"],
    frame: start,
    start,
    end,
    count,
    needsConfirm: true,
  };
}

export function parseAnimationCommand(text: string, ctx: AnimationCommandContext): AnimationCommand | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return (
    exposureCommand(trimmed, ctx) ||
    keyframeCommand(trimmed, ctx) ||
    holdCommand(trimmed, ctx) ||
    inbetweenCommand(trimmed, ctx)
  );
}

export function animationCommandNeedsConfirm(cmd: AnimationCommand | null | undefined): cmd is AnimationCommand {
  return Boolean(cmd && cmd.needsConfirm);
}
