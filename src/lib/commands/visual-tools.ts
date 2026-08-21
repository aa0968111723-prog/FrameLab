/** MCP visual tools. Return VisualAnnotation — never CSS/DOM commands. */

import type { CommandContext } from "./execute.ts";
import { fail } from "@/lib/domain/errors";
import { nid } from "@/lib/domain/ids";
import {
  annotationsFromProblems,
  pointAnnotation,
  rangeAnnotation,
  regionAnnotation,
  type VisualAnnotation,
} from "@/lib/domain/visual-annotation";
import * as repo from "@/lib/framelab/repo";

async function ownTimeline(ctx: CommandContext, timelineId: string) {
  const t = await repo.getTimeline(timelineId);
  if (!t) fail("FRAME_NOT_FOUND", "Timeline not found", 404);
  const p = await repo.getProject(ctx.userId, t.project_id);
  if (!p) fail("PERMISSION_DENIED", "Not your timeline", 403);
  return t;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export async function getVisualContextCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const timelineId = str(args.timelineId);
  const frame = num(args.frameNumber, num(args.frame));
  if (timelineId) await ownTimeline(ctx, timelineId);
  const problems = timelineId ? await repo.listProblemRanges(timelineId) : [];
  const annotations = annotationsFromProblems(
    problems.map((r) => ({
      start: r.start_frame,
      end: r.end_frame,
      peak_frame: r.peak_frame,
      category: r.category,
      severity: r.severity,
      reason: r.reason,
    })),
  );
  return {
    frame_number: frame,
    annotations,
    overlays: ["original", "problems"],
    note: "Visual context is annotation data. Frontend renders it.",
  };
}

export async function annotateFrameCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const frame = num(args.frameNumber, num(args.frame));
  const type = str(args.type, "LABEL").toUpperCase();
  const coords = Array.isArray(args.coordinates)
    ? (args.coordinates as number[])
    : [num(args.x), num(args.y), num(args.w, 0.2), num(args.h, 0.2)];
  const annotation: VisualAnnotation = {
    id: nid("ann"),
    frame_number: frame,
    frame_id: typeof args.frameId === "string" ? args.frameId : null,
    type: (["POINT", "REGION", "PATH", "LABEL", "RANGE"].includes(type) ? type : "LABEL") as VisualAnnotation["type"],
    coordinates: coords.map(Number).filter((n) => Number.isFinite(n)),
    label: str(args.label, "AI marker"),
    severity: (str(args.severity, "info") as VisualAnnotation["severity"]) || "info",
    source: "ai",
    category: str(args.category) || null,
    linked_analysis_id: typeof args.linkedAnalysisId === "string" ? args.linkedAnalysisId : null,
  };
  await repo.insertVisualAnnotation({
    ...annotation,
    userId: ctx.userId,
    projectId: typeof args.projectId === "string" ? args.projectId : null,
    sessionId: typeof args.sessionId === "string" ? args.sessionId : null,
  });
  return { annotation };
}

export async function highlightRegionCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const frame = num(args.frameNumber, num(args.frame));
  const box = {
    x: num(args.x, 0.3),
    y: num(args.y, 0.2),
    w: num(args.w, num(args.width, 0.25)),
    h: num(args.h, num(args.height, 0.25)),
  };
  const annotation = regionAnnotation(nid("ann"), frame, box, str(args.label, "Region"), {
    source: "ai",
    severity: (str(args.severity, "warning") as VisualAnnotation["severity"]) || "warning",
    category: str(args.category) || "MOTION",
  });
  await repo.insertVisualAnnotation({
    ...annotation,
    userId: ctx.userId,
    projectId: typeof args.projectId === "string" ? args.projectId : null,
    sessionId: typeof args.sessionId === "string" ? args.sessionId : null,
  });
  return { annotation };
}

export async function highlightFrameRangeCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const start = num(args.startFrame, num(args.start));
  const end = num(args.endFrame, num(args.end, start));
  const annotation = rangeAnnotation(nid("ann"), start, end, str(args.label, `F${start}–F${end}`), {
    source: "ai",
    severity: (str(args.severity, "warning") as VisualAnnotation["severity"]) || "warning",
    category: str(args.category) || null,
  });
  await repo.insertVisualAnnotation({
    ...annotation,
    userId: ctx.userId,
    projectId: typeof args.projectId === "string" ? args.projectId : null,
    sessionId: typeof args.sessionId === "string" ? args.sessionId : null,
  });
  return { annotation, range: [start, end] };
}

export async function getMotionPathCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const projectId = str(args.projectId);
  if (projectId) {
    const p = await repo.getProject(ctx.userId, projectId);
    if (!p) fail("PERMISSION_DENIED", "Not your project", 403);
  }
  const name = str(args.name);
  const rows = projectId ? await repo.listTrackingPoints(projectId) : [];
  const samples = (name ? rows.filter((r) => r.name === name) : rows).map((r) => ({
    name: r.name,
    frame_number: r.frame_number,
    x: r.x,
    y: r.y,
    status: r.status,
    score: r.score,
  }));
  return { name: name || samples[0]?.name || null, samples, type: "PATH" };
}

export async function getPoseOverlayCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const t = await ownTimeline(ctx, str(args.timelineId));
  const frame = num(args.frameNumber, num(args.frame));
  const poses = await repo.listPoses(t.id);
  const row = poses.find((p) => p.frame_number === frame) ?? poses[0];
  if (!row) return { provider: "framelab-pose-lite", keypoints: [], note: "No pose yet. Run analyze_pose." };
  let keypoints: { name: string; x: number; y: number; confidence: number }[] = [];
  try {
    keypoints = JSON.parse(row.joints_json) as typeof keypoints;
  } catch {
    keypoints = [];
  }
  return {
    provider: row.provider,
    frame_number: row.frame_number,
    keypoints,
    note: row.provider === "rtmpose" ? "MODEL_NOT_AVAILABLE" : "framelab-pose-lite silhouette extrema",
  };
}

export async function getTrackingOverlayCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const projectId = str(args.projectId);
  const p = await repo.getProject(ctx.userId, projectId);
  if (!p) fail("PERMISSION_DENIED", "Not your project", 403);
  const rows = await repo.listTrackingPoints(projectId);
  return { tracks: rows, provider: "framelab-ncc" };
}

export async function getProblemRegionsCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const t = await ownTimeline(ctx, str(args.timelineId));
  const ranges = await repo.listProblemRanges(t.id);
  const annotations = annotationsFromProblems(
    ranges.map((r) => ({
      start: r.start_frame,
      end: r.end_frame,
      peak_frame: r.peak_frame,
      category: r.category,
      severity: r.severity,
      reason: r.reason,
    })),
  );
  return { ranges, annotations };
}

export async function focusProblemCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const t = await ownTimeline(ctx, str(args.timelineId));
  const ranges = await repo.listProblemRanges(t.id);
  const idx = num(args.index, 0);
  const r = ranges[idx] ?? ranges[0];
  if (!r) return { annotation: null, frame: null };
  const annotation = pointAnnotation(
    nid("ann"),
    r.peak_frame,
    0.7,
    0.25,
    `${r.category} · ${r.reason}`,
    { source: "engine", severity: (r.severity as VisualAnnotation["severity"]) || "warning", category: r.category },
  );
  return {
    annotation,
    frame: r.peak_frame,
    range: [r.start_frame, r.end_frame],
    action: "FOCUS",
    note: "Frontend should seek + zoom. MCP does not control the DOM.",
  };
}

export async function compareFramesVisualCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const t = await ownTimeline(ctx, str(args.timelineId));
  const a = num(args.frameA);
  const b = num(args.frameB, a + 1);
  return {
    timelineId: t.id,
    frameA: a,
    frameB: b,
    modes: ["side_by_side", "overlay", "difference", "flicker"],
    annotations: [
      rangeAnnotation(nid("ann"), Math.min(a, b), Math.max(a, b), `Compare F${a} ↔ F${b}`, {
        source: "user",
        severity: "info",
      }),
    ],
  };
}

export async function listVisualAnnotationsCmd(ctx: CommandContext, args: Record<string, unknown>) {
  return repo.listVisualAnnotations({
    userId: ctx.userId,
    projectId: typeof args.projectId === "string" ? args.projectId : undefined,
    sessionId: typeof args.sessionId === "string" ? args.sessionId : undefined,
  });
}

export const VISUAL_TOOLS = [
  "get_visual_context",
  "annotate_frame",
  "highlight_region",
  "highlight_frame_range",
  "get_motion_path",
  "get_pose_overlay",
  "get_tracking_overlay",
  "get_problem_regions",
  "focus_problem",
  "compare_frames_visual",
  "list_visual_annotations",
] as const;

export async function dispatchVisualTool(
  ctx: CommandContext,
  tool: (typeof VISUAL_TOOLS)[number],
  args: Record<string, unknown>,
) {
  switch (tool) {
    case "get_visual_context":
      return getVisualContextCmd(ctx, args);
    case "annotate_frame":
      return annotateFrameCmd(ctx, args);
    case "highlight_region":
      return highlightRegionCmd(ctx, args);
    case "highlight_frame_range":
      return highlightFrameRangeCmd(ctx, args);
    case "get_motion_path":
      return getMotionPathCmd(ctx, args);
    case "get_pose_overlay":
      return getPoseOverlayCmd(ctx, args);
    case "get_tracking_overlay":
      return getTrackingOverlayCmd(ctx, args);
    case "get_problem_regions":
      return getProblemRegionsCmd(ctx, args);
    case "focus_problem":
      return focusProblemCmd(ctx, args);
    case "compare_frames_visual":
      return compareFramesVisualCmd(ctx, args);
    case "list_visual_annotations":
      return listVisualAnnotationsCmd(ctx, args);
    default:
      fail("MCP_TOOL_ERROR", `Unknown visual tool: ${tool}`);
  }
}
