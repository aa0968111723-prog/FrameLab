/** FrameLab Context Engine — domain layer. Not React state. */

export const CONTEXT_PRIORITY = [
  "selected_region",
  "selected_frame_range",
  "current_frame",
  "current_timeline",
  "current_project",
] as const;

export type ContextFocus = (typeof CONTEXT_PRIORITY)[number];

export type RegionSelection = {
  type: "rectangle" | "mask";
  frameId: string;
  frameNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  selectionType: "rectangle" | "mask";
};

export type OnionSkinContext = {
  enabled: boolean;
  previousFrames: number;
  nextFrames: number;
  previousOpacity: number;
  nextOpacity: number;
};

export type OverlayContext = {
  pose: boolean;
  mask: boolean;
  tracking: boolean;
  motion: boolean;
  depth: boolean;
  consistency: boolean;
};

export type CurrentFrameRef = {
  id: string;
  frameNumber: number;
  timestampMs: number;
};

export type FrameLabContext = {
  projectId: string | null;
  videoId: string | null;
  timelineId: string | null;
  currentFrame: CurrentFrameRef | null;
  selectedRange: { startFrame: number; endFrame: number } | null;
  selectedFrames: number[];
  selectedCharacterId: string | null;
  selectedObjectId: string | null;
  selectedRegion: RegionSelection | null;
  onionSkin: OnionSkinContext;
  overlay: OverlayContext;
  viewport: { zoom: number } | null;
  analysisResults: string[];
  conversationId: string | null;
  sessionId: string | null;
  contextVersion: number;
};

export type SerializedContext = {
  project_id: string | null;
  video_id: string | null;
  timeline_id: string | null;
  current_frame: number | null;
  current_frame_id: string | null;
  timestamp_ms: number | null;
  selected_range: [number, number] | null;
  selected_frames: number[];
  selected_character: string | null;
  selected_object: string | null;
  selected_region: RegionSelection | null;
  onion_skin: OnionSkinContext;
  overlay: OverlayContext;
  neighbors_available: boolean;
  analysis_available: string[];
  conversation_id: string | null;
  session_id: string | null;
  context_version: number;
  viewport: { zoom: number } | null;
  focus: ContextFocus;
};

export type ContextLockState = {
  locked: boolean;
  snapshot: SerializedContext | null;
};

export const DEFAULT_ONION_CONTEXT: OnionSkinContext = {
  enabled: true,
  previousFrames: 2,
  nextFrames: 2,
  previousOpacity: 0.35,
  nextOpacity: 0.28,
};

export const DEFAULT_OVERLAY: OverlayContext = {
  pose: false,
  mask: false,
  tracking: false,
  motion: false,
  depth: false,
  consistency: false,
};

export function createEmptyContext(
  partial: Partial<FrameLabContext> = {},
): FrameLabContext {
  const { onionSkin, overlay, ...rest } = partial;
  return {
    projectId: null,
    videoId: null,
    timelineId: null,
    currentFrame: null,
    selectedRange: null,
    selectedFrames: [],
    selectedCharacterId: null,
    selectedObjectId: null,
    selectedRegion: null,
    viewport: { zoom: 1 },
    analysisResults: [],
    conversationId: null,
    sessionId: null,
    contextVersion: 0,
    ...rest,
    onionSkin: { ...DEFAULT_ONION_CONTEXT, ...onionSkin },
    overlay: { ...DEFAULT_OVERLAY, ...overlay },
  };
}

function bump(ctx: FrameLabContext): FrameLabContext {
  return { ...ctx, contextVersion: ctx.contextVersion + 1 };
}

export function setProjectScope(
  ctx: FrameLabContext,
  ids: {
    projectId: string | null;
    videoId?: string | null;
    timelineId?: string | null;
  },
): FrameLabContext {
  const next = {
    ...ctx,
    projectId: ids.projectId,
    videoId: ids.videoId === undefined ? ctx.videoId : ids.videoId,
    timelineId: ids.timelineId === undefined ? ctx.timelineId : ids.timelineId,
  };
  if (
    next.projectId === ctx.projectId &&
    next.videoId === ctx.videoId &&
    next.timelineId === ctx.timelineId
  ) {
    return ctx;
  }
  return bump(next);
}

export function setCurrentFrame(
  ctx: FrameLabContext,
  frame: CurrentFrameRef | null,
): FrameLabContext {
  if (
    (ctx.currentFrame === null && frame === null) ||
    (ctx.currentFrame &&
      frame &&
      ctx.currentFrame.id === frame.id &&
      ctx.currentFrame.frameNumber === frame.frameNumber)
  ) {
    return ctx;
  }
  return bump({
    ...ctx,
    currentFrame: frame,
    selectedFrames: frame ? [frame.frameNumber] : [],
    selectedRange: null,
  });
}

export function setSelectedRange(
  ctx: FrameLabContext,
  start: number,
  end: number,
  current?: CurrentFrameRef | null,
): FrameLabContext {
  const a = Math.min(start, end);
  const b = Math.max(start, end);
  const selected: number[] = [];
  for (let i = a; i <= b; i += 1) selected.push(i);
  return bump({
    ...ctx,
    selectedRange: { startFrame: a, endFrame: b },
    selectedFrames: selected,
    currentFrame: current ?? ctx.currentFrame,
  });
}

export function setSelectedFrames(
  ctx: FrameLabContext,
  frames: number[],
  current?: CurrentFrameRef | null,
): FrameLabContext {
  const selected = [...new Set(frames)].sort((x, y) => x - y);
  return bump({
    ...ctx,
    selectedFrames: selected,
    selectedRange:
      selected.length > 1
        ? { startFrame: selected[0], endFrame: selected[selected.length - 1] }
        : null,
    currentFrame: current ?? ctx.currentFrame,
  });
}

export function setSelectedRegion(
  ctx: FrameLabContext,
  region: RegionSelection | null,
): FrameLabContext {
  return bump({ ...ctx, selectedRegion: region ? normalizeRegion(region) : null });
}

export function clearSelectedRegion(ctx: FrameLabContext): FrameLabContext {
  if (!ctx.selectedRegion) return ctx;
  return bump({ ...ctx, selectedRegion: null });
}

export function setSelectedCharacter(
  ctx: FrameLabContext,
  id: string | null,
): FrameLabContext {
  if (ctx.selectedCharacterId === id) return ctx;
  return bump({ ...ctx, selectedCharacterId: id });
}

export function setSelectedObject(
  ctx: FrameLabContext,
  id: string | null,
): FrameLabContext {
  if (ctx.selectedObjectId === id) return ctx;
  return bump({ ...ctx, selectedObjectId: id });
}

export function setOnionSkinContext(
  ctx: FrameLabContext,
  patch: Partial<OnionSkinContext>,
): FrameLabContext {
  return bump({
    ...ctx,
    onionSkin: {
      ...ctx.onionSkin,
      ...patch,
      previousFrames: Math.min(
        3,
        Math.max(0, patch.previousFrames ?? ctx.onionSkin.previousFrames),
      ),
      nextFrames: Math.min(
        3,
        Math.max(0, patch.nextFrames ?? ctx.onionSkin.nextFrames),
      ),
    },
  });
}

export function setOverlayContext(
  ctx: FrameLabContext,
  patch: Partial<OverlayContext>,
): FrameLabContext {
  return bump({ ...ctx, overlay: { ...ctx.overlay, ...patch } });
}

export function setConversationId(
  ctx: FrameLabContext,
  id: string | null,
): FrameLabContext {
  if (ctx.conversationId === id) return ctx;
  return bump({ ...ctx, conversationId: id });
}

export function setSessionId(ctx: FrameLabContext, id: string): FrameLabContext {
  if (ctx.sessionId === id) return ctx;
  return { ...ctx, sessionId: id };
}

export function setAnalysisResults(
  ctx: FrameLabContext,
  results: string[],
): FrameLabContext {
  return { ...ctx, analysisResults: results };
}

export function resolveFocus(ctx: FrameLabContext): ContextFocus {
  if (ctx.selectedRegion) return "selected_region";
  if (ctx.selectedRange) return "selected_frame_range";
  if (ctx.currentFrame) return "current_frame";
  if (ctx.timelineId) return "current_timeline";
  return "current_project";
}

export function serializeContext(ctx: FrameLabContext): SerializedContext {
  return {
    project_id: ctx.projectId,
    video_id: ctx.videoId,
    timeline_id: ctx.timelineId,
    current_frame: ctx.currentFrame?.frameNumber ?? null,
    current_frame_id: ctx.currentFrame?.id ?? null,
    timestamp_ms: ctx.currentFrame?.timestampMs ?? null,
    selected_range: ctx.selectedRange
      ? [ctx.selectedRange.startFrame, ctx.selectedRange.endFrame]
      : null,
    selected_frames: ctx.selectedFrames.slice(0, 48),
    selected_character: ctx.selectedCharacterId,
    selected_object: ctx.selectedObjectId,
    selected_region: ctx.selectedRegion,
    onion_skin: ctx.onionSkin,
    overlay: ctx.overlay,
    neighbors_available: Boolean(ctx.currentFrame),
    analysis_available: ctx.analysisResults,
    conversation_id: ctx.conversationId,
    session_id: ctx.sessionId,
    context_version: ctx.contextVersion,
    viewport: ctx.viewport,
    focus: resolveFocus(ctx),
  };
}

export function hydrateContext(
  snap: SerializedContext,
  extras: Partial<FrameLabContext> = {},
): FrameLabContext {
  return createEmptyContext({
    projectId: snap.project_id,
    videoId: snap.video_id,
    timelineId: snap.timeline_id,
    currentFrame:
      snap.current_frame_id && snap.current_frame != null
        ? {
            id: snap.current_frame_id,
            frameNumber: snap.current_frame,
            timestampMs: snap.timestamp_ms ?? 0,
          }
        : null,
    selectedRange: snap.selected_range
      ? { startFrame: snap.selected_range[0], endFrame: snap.selected_range[1] }
      : null,
    selectedFrames: snap.selected_frames ?? [],
    selectedCharacterId: snap.selected_character,
    selectedObjectId: snap.selected_object,
    selectedRegion: snap.selected_region,
    onionSkin: { ...DEFAULT_ONION_CONTEXT, ...snap.onion_skin },
    overlay: { ...DEFAULT_OVERLAY, ...snap.overlay },
    analysisResults: snap.analysis_available ?? [],
    conversationId: snap.conversation_id,
    sessionId: snap.session_id,
    contextVersion: snap.context_version,
    viewport: snap.viewport ?? { zoom: 1 },
    ...extras,
  });
}

export function lockContext(ctx: FrameLabContext): ContextLockState {
  return { locked: true, snapshot: serializeContext(ctx) };
}

export function unlockContext(): ContextLockState {
  return { locked: false, snapshot: null };
}

export function effectiveContext(
  live: FrameLabContext,
  lock: ContextLockState,
): FrameLabContext {
  if (!lock.locked || !lock.snapshot) return live;
  const frozen = hydrateContext(lock.snapshot);
  return {
    ...frozen,
    sessionId: live.sessionId,
    conversationId: live.conversationId ?? frozen.conversationId,
    contextVersion: live.contextVersion,
  };
}

export function isStaleContext(
  snapshotVersion: number,
  liveVersion: number,
  lock: ContextLockState,
): boolean {
  if (lock.locked) return false;
  return snapshotVersion < liveVersion;
}

export function normalizeRegion(region: RegionSelection): RegionSelection {
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  const x = clamp01(region.x);
  const y = clamp01(region.y);
  const width = Math.min(1 - x, Math.max(0.001, region.width));
  const height = Math.min(1 - y, Math.max(0.001, region.height));
  return {
    ...region,
    type: region.type === "mask" ? "mask" : "rectangle",
    selectionType: region.selectionType === "mask" ? "mask" : "rectangle",
    x,
    y,
    width,
    height,
  };
}

export function pixelsFromNormalized(
  region: RegionSelection,
  frameWidth: number,
  frameHeight: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.round(region.x * frameWidth),
    y: Math.round(region.y * frameHeight),
    w: Math.max(1, Math.round(region.width * frameWidth)),
    h: Math.max(1, Math.round(region.height * frameHeight)),
  };
}

export function normalizedFromPixels(
  box: { x: number; y: number; w: number; h: number },
  frameWidth: number,
  frameHeight: number,
  meta: { frameId: string; frameNumber: number },
): RegionSelection {
  const w = Math.max(1, frameWidth);
  const h = Math.max(1, frameHeight);
  return normalizeRegion({
    type: "rectangle",
    selectionType: "rectangle",
    frameId: meta.frameId,
    frameNumber: meta.frameNumber,
    x: box.x / w,
    y: box.y / h,
    width: box.w / w,
    height: box.h / h,
  });
}

/** Crop box with 10–20% padding, still normalized to 0–1. */
export function paddedNormalizedRegion(
  region: RegionSelection,
  padding = 0.15,
): RegionSelection {
  const padX = region.width * padding;
  const padY = region.height * padding;
  return normalizeRegion({
    ...region,
    x: region.x - padX,
    y: region.y - padY,
    width: region.width + padX * 2,
    height: region.height + padY * 2,
  });
}

export function neighborFrameNumbers(
  current: number,
  count: number,
  before: number,
  after: number,
): number[] {
  const out: number[] = [];
  for (let i = current - before; i <= current + after; i += 1) {
    if (i >= 0 && i < count) out.push(i);
  }
  return out;
}

export type ResolvedAskContext = {
  focus: ContextFocus;
  currentFrame: number | null;
  range: [number, number] | null;
  region: RegionSelection | null;
  characterId: string | null;
  objectId: string | null;
  neighbors: number[];
  summary: string;
};

export function resolveAskContext(
  ctx: FrameLabContext,
  frameCount = 0,
): ResolvedAskContext {
  const focus = resolveFocus(ctx);
  const current = ctx.currentFrame?.frameNumber ?? null;
  const range: [number, number] | null = ctx.selectedRange
    ? [ctx.selectedRange.startFrame, ctx.selectedRange.endFrame]
    : current != null
      ? [current, current]
      : null;
  const before = ctx.onionSkin.enabled ? ctx.onionSkin.previousFrames : 2;
  const after = ctx.onionSkin.enabled ? ctx.onionSkin.nextFrames : 2;
  const neighbors =
    current != null ? neighborFrameNumbers(current, frameCount || 10_000, before, after) : [];
  const bits: string[] = [];
  if (ctx.projectId) bits.push(`project ${ctx.projectId}`);
  if (ctx.timelineId) bits.push(`timeline ${ctx.timelineId}`);
  if (current != null) bits.push(`F${current}`);
  if (range && range[0] !== range[1]) bits.push(`range F${range[0]}–F${range[1]}`);
  if (ctx.selectedRegion) bits.push("region selected");
  if (ctx.selectedCharacterId) bits.push(`character ${ctx.selectedCharacterId}`);
  return {
    focus,
    currentFrame: current,
    range,
    region: ctx.selectedRegion,
    characterId: ctx.selectedCharacterId,
    objectId: ctx.selectedObjectId,
    neighbors,
    summary: bits.join(" · ") || "no workspace context",
  };
}

export const ContextSerializer = {
  serialize: serializeContext,
  hydrate: hydrateContext,
};

export const ContextResolver = {
  resolve: resolveAskContext,
  focus: resolveFocus,
  effective: effectiveContext,
  lock: lockContext,
  unlock: unlockContext,
  isStale: isStaleContext,
};
