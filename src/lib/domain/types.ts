export const FRAME_TYPES = [
  "KEY",
  "BREAKDOWN",
  "INBETWEEN",
  "HOLD",
  "GENERATED",
  "REPAIRED",
  "GENERATED_BREAKDOWN",
] as const;

export type FrameType = (typeof FRAME_TYPES)[number];

export const MOTION_CURVES = [
  "linear",
  "ease_in",
  "ease_out",
  "ease_in_out",
  "hold",
  "custom",
] as const;

export type MotionCurve = (typeof MOTION_CURVES)[number];

export const JOB_TYPES = [
  "VIDEO_INGEST",
  "FRAME_EXTRACTION",
  "KEYFRAME_DETECTION",
  "SEGMENTATION",
  "POSE_ANALYSIS",
  "OPTICAL_FLOW",
  "POINT_TRACKING",
  "DEPTH_ANALYSIS",
  "VLM_ANALYSIS",
  "CONSISTENCY_ANALYSIS",
  "INTERPOLATION",
  "GENERATIVE_REPAIR",
  "REPAIR_INTERPOLATION",
  "GENERATE_INBETWEENS",
  "RENDER",
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATES = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export type JobState = (typeof JOB_STATES)[number];

export const SCOPES = [
  "READ",
  "ANALYZE",
  "SUGGEST",
  "EDIT",
  "GENERATE",
  "RENDER",
  "ADMIN",
] as const;

export type Scope = (typeof SCOPES)[number];

export const EDGE_TYPES = [
  "NEXT_FRAME",
  "PREVIOUS_FRAME",
  "SAME_CHARACTER",
  "SAME_OBJECT",
  "TRACKS_TO",
  "MOVES_TO",
  "APPEARS_IN",
  "DISAPPEARS",
  "OCCLUDES",
  "CONTACTS",
  "GENERATED_FROM",
  "REPAIRED_FROM",
  "BETWEEN",
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];

export const CONSISTENCY_CATEGORIES = [
  "CHARACTER_IDENTITY",
  "FACE",
  "BODY",
  "HAND",
  "POSE",
  "CLOTHING",
  "OBJECT",
  "BACKGROUND",
  "MOTION",
  "DEPTH",
  "CONTACT",
  "CAMERA",
  "TEMPORAL_FLICKER",
  "MOTION_CONTINUITY",
  "POSE_CONTINUITY",
  "TRACKING_CONTINUITY",
  "CHARACTER_STABILITY",
  "OBJECT_STABILITY",
  "CONTACT_CONTINUITY",
] as const;

export type ConsistencyCategory = (typeof CONSISTENCY_CATEGORIES)[number];

export const ANALYSIS_LEVELS = [
  "LEVEL_0",
  "LEVEL_1",
  "LEVEL_2",
  "LEVEL_3",
] as const;

export type AnalysisLevel = (typeof ANALYSIS_LEVELS)[number];

export const TRACK_STATUSES = [
  "visible",
  "occluded",
  "lost",
  "recovered",
] as const;

export type TrackStatus = (typeof TRACK_STATUSES)[number];

export type OnionLayers = {
  prev3: boolean;
  prev2: boolean;
  prev1: boolean;
  next1: boolean;
  next2: boolean;
  next3: boolean;
};

export const DEFAULT_ONION_LAYERS: OnionLayers = {
  prev3: true,
  prev2: true,
  prev1: true,
  next1: true,
  next2: true,
  next3: true,
};

export type OnionSkinState = {
  enabled: boolean;
  prev: number;
  next: number;
  opacityPrev: number;
  opacityNext: number;
  layers: OnionLayers;
};

export type TimelineEngineState = {
  currentFrame: number;
  selectedFrames: number[];
  selectedRange: [number, number] | null;
  playhead: number;
  fps: number;
  zoom: number;
  onionSkin: OnionSkinState;
  loopRange: [number, number] | null;
  isPlaying: boolean;
  frameCount: number;
  keyframes: number[];
  breakdowns: number[];
  durations: Record<number, number>;
};

export type FrameRecord = {
  id: string;
  timelineId: string;
  frameNumber: number;
  timestampMs: number;
  durationMs: number;
  frameType: FrameType;
  imageData: string;
  thumbnailData: string;
  width: number;
  height: number;
  isLocked: boolean;
  notes: string;
  contentHash: string;
};

export type ProjectRecord = {
  id: string;
  userId: string;
  name: string;
  description: string;
  fps: number;
  width: number;
  height: number;
  createdAt: string;
  updatedAt: string;
};

export type ConsistencyScoreMap = {
  pixel_continuity?: number;
  temporal_flicker?: number;
  motion_spike?: number;
  luma_jump?: number;
};

export type ConsistencyResult = {
  frame: number;
  frameId: string;
  scores: ConsistencyScoreMap;
  unavailable: ConsistencyCategory[];
  severity: "ok" | "info" | "warning" | "error" | "critical";
  repairWindow: [number, number] | null;
  categories: ConsistencyCategory[];
};

export type CharacterTrackRow = {
  frameNumber: number;
  frameId: string | null;
  visible: boolean;
  occluded: boolean;
  status: TrackStatus;
};

export function isFrameType(value: string): value is FrameType {
  return (FRAME_TYPES as readonly string[]).includes(value);
}

export function padFrame(n: number, width = 3): string {
  return `F${String(n).padStart(width, "0")}`;
}
