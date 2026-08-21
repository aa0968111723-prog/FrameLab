export const TIMELINE_OPS = [
  "add_frame",
  "insert_frame",
  "duplicate_frame",
  "delete_frame",
  "clear_frame",
  "hold_frame",
  "create_breakdown",
] as const;
export type TimelineOp = (typeof TIMELINE_OPS)[number];


export type FrameSnap = {
  id: string;
  timelineId: string;
  frameNumber: number;
  timestampMs: number;
  durationMs: number;
  frameType: string;
  width: number;
  height: number;
  contentHash: string;
  notes: string;
  isLocked: boolean;
  exposureCount: number;
  fullAsset: string;
  previewAsset: string;
  thumbnailAsset: string;
  originalAsset: string;
  activeAsset: string;
};

export type TimelineEdit = {
  op: TimelineOp;
  timelineId: string;
  created?: FrameSnap;
  removed?: FrameSnap;
  before?: FrameSnap;
  after?: FrameSnap;
};

export function isTimelineEdit(raw: unknown): raw is TimelineEdit {
  if (!raw || typeof raw !== "object") return false;
  const op = (raw as { op?: unknown }).op;
  return typeof op === "string" && (TIMELINE_OPS as readonly string[]).includes(op);
}
