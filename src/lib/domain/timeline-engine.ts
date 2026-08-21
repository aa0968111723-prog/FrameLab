import {
  DEFAULT_ONION_LAYERS,
  type OnionLayers,
  type OnionSkinState,
  type TimelineEngineState,
} from "./types.ts";

export const DEFAULT_ONION: OnionSkinState = {
  enabled: true,
  prev: 2,
  next: 2,
  opacityPrev: 0.35,
  opacityNext: 0.28,
  layers: { ...DEFAULT_ONION_LAYERS },
};

function withOnion(onion?: Partial<OnionSkinState> | null): OnionSkinState {
  return {
    ...DEFAULT_ONION,
    ...onion,
    layers: { ...DEFAULT_ONION_LAYERS, ...(onion?.layers ?? {}) },
  };
}

export function createTimelineState(
  partial: Partial<Omit<TimelineEngineState, "onionSkin">> & {
    onionSkin?: Partial<OnionSkinState>;
  } = {},
): TimelineEngineState {
  const { onionSkin, ...rest } = partial;
  return {
    currentFrame: 0,
    selectedFrames: [0],
    selectedRange: null,
    playhead: 0,
    fps: 24,
    zoom: 1,
    loopRange: null,
    isPlaying: false,
    frameCount: 0,
    keyframes: [],
    breakdowns: [],
    durations: {},
    ...rest,
    onionSkin: withOnion(onionSkin),
  };
}

function clampFrame(n: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(n)));
}

export function seek(
  state: TimelineEngineState,
  frame: number,
): TimelineEngineState {
  const f = clampFrame(frame, state.frameCount);
  return {
    ...state,
    currentFrame: f,
    playhead: f,
    selectedFrames: [f],
    selectedRange: null,
  };
}

export function nextFrame(state: TimelineEngineState): TimelineEngineState {
  const count = state.frameCount;
  if (count <= 0) return state;
  let f = state.currentFrame + 1;
  if (state.loopRange) {
    const [a, b] = state.loopRange;
    if (f > b) f = a;
  } else if (f >= count) {
    f = state.isPlaying ? 0 : count - 1;
  }
  return seek(state, f);
}

export function previousFrame(state: TimelineEngineState): TimelineEngineState {
  const count = state.frameCount;
  if (count <= 0) return state;
  let f = state.currentFrame - 1;
  if (state.loopRange) {
    const [a, b] = state.loopRange;
    if (f < a) f = b;
  } else if (f < 0) {
    f = 0;
  }
  return seek(state, f);
}

export function selectRange(
  state: TimelineEngineState,
  start: number,
  end: number,
): TimelineEngineState {
  const a = clampFrame(Math.min(start, end), state.frameCount);
  const b = clampFrame(Math.max(start, end), state.frameCount);
  const selected: number[] = [];
  for (let i = a; i <= b; i += 1) selected.push(i);
  return {
    ...state,
    selectedRange: [a, b],
    selectedFrames: selected,
    currentFrame: b,
    playhead: b,
  };
}

export function toggleSelect(
  state: TimelineEngineState,
  frame: number,
): TimelineEngineState {
  const f = clampFrame(frame, state.frameCount);
  const has = state.selectedFrames.includes(f);
  const selected = has
    ? state.selectedFrames.filter((n) => n !== f)
    : [...state.selectedFrames, f].sort((x, y) => x - y);
  return {
    ...state,
    currentFrame: f,
    playhead: f,
    selectedFrames: selected.length ? selected : [f],
    selectedRange:
      selected.length > 1
        ? [selected[0], selected[selected.length - 1]]
        : null,
  };
}

export function setOnionSkin(
  state: TimelineEngineState,
  patch: Partial<OnionSkinState> & { layers?: Partial<OnionLayers> },
): TimelineEngineState {
  return {
    ...state,
    onionSkin: {
      ...state.onionSkin,
      ...patch,
      prev: Math.min(3, Math.max(0, Math.round(patch.prev ?? state.onionSkin.prev))),
      next: Math.min(3, Math.max(0, Math.round(patch.next ?? state.onionSkin.next))),
      opacityPrev: Math.min(
        0.8,
        Math.max(0.05, patch.opacityPrev ?? state.onionSkin.opacityPrev),
      ),
      opacityNext: Math.min(
        0.8,
        Math.max(0.05, patch.opacityNext ?? state.onionSkin.opacityNext),
      ),
      layers: {
        ...state.onionSkin.layers,
        ...(patch.layers ?? {}),
      },
    },
  };
}

export function setLoopRange(
  state: TimelineEngineState,
  range: [number, number] | null,
): TimelineEngineState {
  if (!range) return { ...state, loopRange: null };
  const a = clampFrame(Math.min(range[0], range[1]), state.frameCount);
  const b = clampFrame(Math.max(range[0], range[1]), state.frameCount);
  return { ...state, loopRange: [a, b] };
}

export function setZoom(
  state: TimelineEngineState,
  zoom: number,
): TimelineEngineState {
  return { ...state, zoom: Math.min(8, Math.max(0.25, zoom)) };
}

function layerOn(layers: OnionLayers, side: "prev" | "next", i: number): boolean {
  if (side === "prev") {
    if (i === 1) return layers.prev1 !== false;
    if (i === 2) return layers.prev2 !== false;
    if (i === 3) return layers.prev3 !== false;
  } else {
    if (i === 1) return layers.next1 !== false;
    if (i === 2) return layers.next2 !== false;
    if (i === 3) return layers.next3 !== false;
  }
  return true;
}

export function onionNeighbors(
  current: number,
  count: number,
  onion: OnionSkinState,
): { prev: number[]; next: number[] } {
  if (!onion.enabled || count <= 0) return { prev: [], next: [] };
  const layers = onion.layers ?? DEFAULT_ONION_LAYERS;
  const prev: number[] = [];
  const next: number[] = [];
  for (let i = onion.prev; i >= 1; i -= 1) {
    const f = current - i;
    if (f < 0) continue;
    if (!layerOn(layers, "prev", i)) continue;
    prev.push(f);
  }
  for (let i = 1; i <= onion.next; i += 1) {
    const f = current + i;
    if (f >= count) continue;
    if (!layerOn(layers, "next", i)) continue;
    next.push(f);
  }
  return { prev, next };
}

export function markKeyframe(
  state: TimelineEngineState,
  frame: number,
): TimelineEngineState {
  const f = clampFrame(frame, state.frameCount);
  const keyframes = state.keyframes.includes(f)
    ? state.keyframes
    : [...state.keyframes, f].sort((a, b) => a - b);
  return { ...state, currentFrame: f, playhead: f, keyframes };
}

export function unmarkKeyframe(
  state: TimelineEngineState,
  frame: number,
): TimelineEngineState {
  return {
    ...state,
    keyframes: state.keyframes.filter((n) => n !== frame),
  };
}

export function markBreakdown(
  state: TimelineEngineState,
  frame: number,
): TimelineEngineState {
  const f = clampFrame(frame, state.frameCount);
  const breakdowns = state.breakdowns.includes(f)
    ? state.breakdowns
    : [...state.breakdowns, f].sort((a, b) => a - b);
  return { ...state, currentFrame: f, playhead: f, breakdowns };
}

export function unmarkBreakdown(
  state: TimelineEngineState,
  frame: number,
): TimelineEngineState {
  return {
    ...state,
    breakdowns: state.breakdowns.filter((n) => n !== frame),
  };
}

export function setFrameDurationLocal(
  state: TimelineEngineState,
  frame: number,
  durationMs: number,
): TimelineEngineState {
  const f = clampFrame(frame, state.frameCount);
  return {
    ...state,
    durations: { ...state.durations, [f]: Math.max(1, Math.round(durationMs)) },
  };
}
