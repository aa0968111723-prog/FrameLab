/** FrameLab command dispatcher — MCP / REST / UI share this path. */
import {
  getOpticalFlow,
  getPointTracker,
  getInterpolation,
  getPose,
} from "@/lib/ai/providers";
import { scoreWindow } from "@/lib/ai/consistency";
import { analyzeFrameWithGrok } from "@/lib/ai/grok-vision";
import { getDeviceInfo, listModels } from "@/lib/ai/registry";
import { detectContactBreaks } from "@/lib/domain/contact";
import { fail, FrameLabError } from "@/lib/domain/errors";
import { sequentialEdges } from "@/lib/domain/frame-graph";
import { nid } from "@/lib/domain/ids";
import { decodeJpegBase64, encodeJpegBase64, hashBytes, makeThumbnail } from "@/lib/domain/image-codec";
import {
  DEFAULT_PLAYBACK_FPS,
  frameDurationMs,
  parseFpsField,
  resolveExtractFps,
  resolvePlaybackFps,
} from "@/lib/domain/fps";
import {
  cropRgba,
  edgeMagnitude,
  lumaCentroid,
  ssimLike,
} from "@/lib/domain/lightweight-analysis";
import {
  histogram16,
  histogramDistance,
  meanAbsDiff,
  motionField,
  type RegionBox,
} from "@/lib/domain/pixel-metrics";
import {
  assertToolAllowed,
  isHighRisk,
  parseScopes,
  requireConfirmedEdit,
  TOOL_SCOPES,
  type Scope,
} from "@/lib/domain/permissions";
import { generateBouncingBall } from "@/lib/domain/sample-ball";
import { canonicalTrackStatus } from "@/lib/domain/track-continuity";
import { FRAME_TYPES, isFrameType, type FrameType } from "@/lib/domain/types";
import * as repo from "@/lib/framelab/repo";
import { ownCharacter, ownObject, ownProject, ownTimeline } from "./ownership.ts";
import { startJob, withJob } from "@/lib/jobs/queue";
import {
  concatJpegSequence,
  extractFramesWithFfmpeg,
  readJpegFileAsBase64,
  removeDir,
} from "@/lib/media/ffmpeg";
import { putBytes, ensureProjectLayout, projectRoot } from "@/lib/storage/local";
import { callContextBridge, MCP_CONTEXT_TOOLS } from "@/lib/mcp/context-bridge";
import { dispatchVisualTool, VISUAL_TOOLS } from "./visual-tools.ts";

export type CommandContext = {
  userId: string;
  source: string;
  caller: string;
  scopes: Scope[];
  projectScope?: string;
  clientId?: string | null;
};

export const ALL_SCOPES: Scope[] = [
  "READ",
  "ANALYZE",
  "SUGGEST",
  "EDIT",
  "GENERATE",
  "RENDER",
  "ADMIN",
];

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

// ownProject / ownTimeline now live in ./ownership.ts so every command module
// shares one gate — see that file for why the pair must not be re-inlined.

async function loadOwnedFrame(ctx: CommandContext, args: Record<string, unknown>) {
  if (typeof args.frameId === "string" && args.frameId) {
    const frame = await repo.getFrame(args.frameId);
    if (!frame) fail("FRAME_NOT_FOUND", "Frame not found", 404);
    await ownTimeline(ctx, frame.timeline_id);
    return frame;
  }
  const timelineId = str(args.timelineId);
  if (!timelineId) fail("VALIDATION_ERROR", "frameId or timelineId required");
  const t = await ownTimeline(ctx, timelineId);
  const n = num(args.frameNumber, Number.NaN);
  if (!Number.isFinite(n)) fail("VALIDATION_ERROR", "frameNumber required");
  const frame = await repo.getFrameByNumber(t.id, n);
  if (!frame) fail("FRAME_NOT_FOUND", "Frame not found", 404);
  return frame;
}

function snapshotFrame(frame: repo.FrameRow) {
  return {
    imageData: "",
    thumbnailData: "",
    contentHash: frame.content_hash,
    frameType: frame.frame_type,
    durationMs: frame.duration_ms,
    notes: frame.notes,
    isLocked: frame.is_locked,
    width: frame.width,
    height: frame.height,
    originalAsset: frame.original_asset ?? null,
    activeAsset: frame.active_asset ?? null,
    fullAsset: frame.full_asset ?? null,
    previewAsset: frame.preview_asset ?? null,
    thumbnailAsset: frame.thumbnail_asset ?? null,
  };
}

async function recordRevision(
  ctx: CommandContext,
  action: string,
  projectId: string,
  frameId: string | null,
  previous: unknown,
  next: unknown,
  extra?: { timelineId?: string; startFrame?: number; endFrame?: number },
) {
  return repo.insertRevision({
    projectId,
    frameId,
    action,
    source: ctx.source,
    caller: ctx.caller,
    previous,
    next,
    timelineId: extra?.timelineId ?? null,
    startFrame: extra?.startFrame ?? null,
    endFrame: extra?.endFrame ?? null,
  });
}

function frameRangeOf(args: Record<string, unknown>): string | null {
  const a = args.startFrame ?? args.frameA ?? args.frameNumber;
  const b = args.endFrame ?? args.frameB ?? args.frameNumber;
  if (typeof a === "number" && typeof b === "number") return `${a}-${b}`;
  return null;
}

export async function executeTool(
  ctx: CommandContext,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<{ ok: true; data: unknown } | { ok: false; code: string; error: string }> {
  const started = Date.now();
  let status = "ok";
  let error: string | null = null;
  let revisionId: string | null = null;
  try {
    assertToolAllowed(ctx.scopes, tool);
    if (isHighRisk(tool) && (tool === "execute_repair_plan" || tool === "restore_revision" || tool === "generate_inbetweens" || tool === "regenerate_inbetween_range" || tool === "accept_generated_frames")) {
      // confirmed is checked in the specific branches so other high-risk tools stay as-is
    }
    const data = await dispatch(ctx, tool, args);
    if (data && typeof data === "object" && "revisionId" in data) {
      const rid = (data as { revisionId?: unknown }).revisionId;
      if (typeof rid === "string") revisionId = rid;
    }
    return { ok: true, data };
  } catch (err) {
    status = "error";
    if (err instanceof FrameLabError) {
      error = err.message;
      return { ok: false, code: err.code, error: err.message };
    }
    error = err instanceof Error ? err.message : String(err);
    return { ok: false, code: "JOB_FAILED", error };
  } finally {
    await repo.insertAudit({
      userId: ctx.userId,
      clientId: ctx.clientId ?? null,
      tool,
      caller: ctx.caller,
      scopeUsed: TOOL_SCOPES[tool] ?? ctx.scopes.join(","),
      args,
      projectId: typeof args.projectId === "string" ? args.projectId : null,
      frameRange: frameRangeOf(args),
      status,
      durationMs: Date.now() - started,
      error,
      revisionId,
    }).catch(() => undefined);
  }
}

async function dispatch(ctx: CommandContext, tool: string, args: Record<string, unknown>): Promise<unknown> {
  if ((MCP_CONTEXT_TOOLS as readonly string[]).includes(tool)) {
    return callContextBridge(ctx, tool as (typeof MCP_CONTEXT_TOOLS)[number], args);
  }
  if ((VISUAL_TOOLS as readonly string[]).includes(tool)) {
    return dispatchVisualTool(ctx, tool as (typeof VISUAL_TOOLS)[number], args);
  }
  switch (tool) {
    case "list_projects":
      return repo.listProjects(ctx.userId);
    case "get_project": {
      const p = await ownProject(ctx, str(args.projectId));
      const timelines = await repo.listTimelines(p.id);
      return { ...p, timelines };
    }
    case "create_project":
      return createBlankProject(ctx, { name: str(args.name, "Untitled"), fps: num(args.fps, DEFAULT_PLAYBACK_FPS) });
    case "get_video": {
      const v = await repo.getVideo(str(args.videoId));
      if (!v) fail("FRAME_NOT_FOUND", "Video not found", 404);
      await ownProject(ctx, v.project_id);
      return v;
    }
    case "list_videos":
      await ownProject(ctx, str(args.projectId));
      return repo.listVideos(str(args.projectId));
    case "get_timeline": {
      const t = await ownTimeline(ctx, str(args.timelineId));
      const frames = await repo.listFramesMeta(t.id);
      return { ...t, frames };
    }
    case "get_frame":
      return loadOwnedFrame(ctx, args);
    case "get_frame_range": {
      const t = await ownTimeline(ctx, str(args.timelineId));
      const frames = await repo.listFramesMeta(t.id);
      const start = num(args.startFrame);
      const end = num(args.endFrame);
      return frames.filter((f) => f.frame_number >= start && f.frame_number <= end);
    }
    case "get_frame_window": {
      const t = await ownTimeline(ctx, str(args.timelineId));
      const center = num(args.centerFrame);
      const before = num(args.before, 2);
      const after = num(args.after, 2);
      const frames = await repo.listFramesMeta(t.id);
      return frames.filter(
        (f) => f.frame_number >= center - before && f.frame_number <= center + after,
      );
    }
    case "get_motion_between": {
      const t = await ownTimeline(ctx, str(args.timelineId));
      const rows = await repo.listMotion(t.id);
      const b = num(args.frameB);
      return rows.filter((m) => m.frame_number === b);
    }
    case "get_keyframes": {
      const t = await ownTimeline(ctx, str(args.timelineId));
      const frames = await repo.listFramesMeta(t.id);
      return frames.filter((f) => f.frame_type === "KEY" || f.frame_type === "BREAKDOWN");
    }
    case "get_character":
      return ownCharacter(ctx, str(args.characterId));
    case "get_character_track": {
      const c = await ownCharacter(ctx, str(args.characterId));
      return repo.characterTrack(c.id);
    }
    case "get_object":
      return ownObject(ctx, str(args.objectId));
    case "get_object_track": {
      const o = await ownObject(ctx, str(args.objectId));
      return repo.objectTrack(o.id);
    }
    case "get_consistency_results": {
      const t = await ownTimeline(ctx, str(args.timelineId));
      return repo.listConsistency(t.id);
    }
    case "get_problem_frames": {
      const t = await ownTimeline(ctx, str(args.timelineId));
      const rows = await repo.listConsistency(t.id);
      return rows.filter((r) => r.severity === "warning" || r.severity === "error" || r.severity === "critical");
    }
    case "get_job": {
      const job = await repo.getJob(ctx.userId, str(args.jobId));
      if (!job) fail("FRAME_NOT_FOUND", "Job not found", 404);
      return job;
    }
    case "list_jobs":
      return repo.listJobs(ctx.userId, typeof args.projectId === "string" ? args.projectId : undefined);
    case "get_model_status":
      return { models: listModels(), devices: getDeviceInfo() };
    case "restore_revision":
      requireConfirmedEdit("restore_revision", args);
      return restoreRevision(ctx, str(args.revisionId));
    case "list_revisions": {
      await ownProject(ctx, str(args.projectId));
      return repo.listRevisions(str(args.projectId), typeof args.frameId === "string" ? args.frameId : undefined);
    }
    case "analyze_frame":
      return analyzeFrame(ctx, args);
    case "analyze_frame_range":
    case "analyze_consistency":
    case "detect_problem_frames":
    case "rerun_consistency":
      return analyzeRange(ctx, args);
    case "analyze_pose": {
      const { analyzePoseAssist } = await import("./assist-tools");
      return analyzePoseAssist(ctx, args);
    }
    case "analyze_motion": {
      const { analyzeMotionAssist } = await import("./assist-tools");
      return analyzeMotionAssist(ctx, args);
    }
    case "analyze_tracking":
    case "rerun_tracking":
    case "retrack_range":
      return analyzeTracking(ctx, args);
    case "detect_keyframes":
      return detectKeyframes(ctx, args);
    case "compare_frames":
      return compareFrames(ctx, args);
    case "create_keyframe":
      return setType(ctx, args, "KEY");
    case "remove_keyframe":
      return setType(ctx, args, "INBETWEEN");
    case "lock_keyframe":
      return setLocked(ctx, args, true);
    case "unlock_keyframe":
      return setLocked(ctx, args, false);
    case "mark_breakdown":
      return setType(ctx, args, "BREAKDOWN");
    case "mark_inbetween":
      return setType(ctx, args, "INBETWEEN");
    case "duplicate_frame": {
      const { duplicateFrameCmd } = await import("./timeline-edit");
      return duplicateFrameCmd(ctx, args);
    }
    case "add_frame": {
      const { addFrameCmd } = await import("./timeline-edit");
      return addFrameCmd(ctx, args);
    }
    case "insert_frame": {
      const { insertFrameCmd } = await import("./timeline-edit");
      return insertFrameCmd(ctx, args);
    }
    case "clear_frame": {
      const { clearFrameCmd } = await import("./timeline-edit");
      return clearFrameCmd(ctx, args);
    }
    case "hold_frame": {
      const { holdFrameCmd } = await import("./timeline-edit");
      return holdFrameCmd(ctx, args);
    }
    case "replace_frame":
      return replaceFrame(ctx, args);
    case "delete_frame": {
      const { deleteFrameCmd } = await import("./timeline-edit");
      return deleteFrameCmd(ctx, args);
    }
    case "set_frame_duration":
      return setDuration(ctx, args);
    case "set_frame_type":
      return setType(ctx, args, str(args.frameType));
    case "set_frame_notes":
      return setNotes(ctx, args);
    case "set_onion_skin":
      return { ok: true, enabled: args.enabled !== false };
    case "create_character": {
      await ownProject(ctx, str(args.projectId));
      const id = nid("chr");
      await repo.insertCharacter({ id, projectId: str(args.projectId), name: str(args.name) });
      return { id, name: str(args.name) };
    }
    case "assign_character": {
      const frame = await loadOwnedFrame(ctx, args);
      const character = await ownCharacter(ctx, str(args.characterId));
      await repo.assignCharacter(frame.id, character.id);
      return { frameId: frame.id, characterId: character.id };
    }
    case "assign_character_range": {
      const t = await ownTimeline(ctx, str(args.timelineId));
      const frames = await repo.listFramesMeta(t.id);
      const start = num(args.startFrame);
      const end = num(args.endFrame);
      const characterId = str(args.characterId);
      for (const f of frames) {
        if (f.frame_number >= start && f.frame_number <= end) {
          await repo.assignCharacter(f.id, characterId);
        }
      }
      return { characterId, start, end };
    }
    case "set_character_visibility": {
      const frame = await loadOwnedFrame(ctx, args);
      await repo.setCharacterVisibility(frame.id, str(args.characterId), {
        visible: args.visible !== false,
        occluded: Boolean(args.occluded),
      });
      return { frameId: frame.id, characterId: str(args.characterId) };
    }
    case "list_characters":
      await ownProject(ctx, str(args.projectId));
      return repo.listCharacters(str(args.projectId));
    case "list_objects":
      await ownProject(ctx, str(args.projectId));
      return repo.listObjects(str(args.projectId));
    case "create_object": {
      await ownProject(ctx, str(args.projectId));
      const id = nid("obj");
      await repo.insertObject({ id, projectId: str(args.projectId), name: str(args.name) });
      return { id, name: str(args.name) };
    }
    case "assign_object": {
      const frame = await loadOwnedFrame(ctx, args);
      await repo.assignObject(frame.id, str(args.objectId));
      return { frameId: frame.id, objectId: str(args.objectId) };
    }
    case "create_tracking_point":
    case "create_track":
      return createTrackingPoint(ctx, args);
    case "get_graph": {
      await ownProject(ctx, str(args.projectId));
      const edges = await repo.listEdges(str(args.projectId));
      const type = typeof args.edgeType === "string" ? args.edgeType : null;
      return type ? edges.filter((e) => e.edge_type === type) : edges;
    }
    case "get_frame_analysis": {
      const frame = await loadOwnedFrame(ctx, { frameId: args.frameId });
      return repo.getConsistencyForFrame(frame.id);
    }
    case "create_keyframe_range": {
      const t = await ownTimeline(ctx, str(args.timelineId));
      const start = num(args.startFrame);
      const end = num(args.endFrame);
      await setType(ctx, { timelineId: t.id, frameNumber: start }, "KEY");
      await setType(ctx, { timelineId: t.id, frameNumber: end }, "KEY");
      return { start, end };
    }
    case "undo":
      return undoFrame(ctx, args);
    case "redo":
      return redoFrame(ctx, args);
    case "list_audit_logs":
      return repo.listAudit(ctx.userId, num(args.limit, 30));
    case "create_sample_project":
      return createSampleProject(ctx, typeof args.name === "string" ? args.name : undefined);
    case "ingest_frames":
      return ingestFrames(ctx, {
        name: str(args.name),
        fps: num(args.fps, DEFAULT_PLAYBACK_FPS),
        frames: (Array.isArray(args.frames) ? args.frames : []) as {
          imageData: string;
          frameNumber: number;
        }[],
        projectId: typeof args.projectId === "string" ? args.projectId : undefined,
        replace: args.replace === false ? false : true,
      });
    case "generate_inbetweens": {
      requireConfirmedEdit("generate_inbetweens", args);
      const { generateInbetweensCmd } = await import("./inbetween-tools");
      return generateInbetweensCmd(ctx, args);
    }
    case "interpolate_frames":
      return interpolateFrames(ctx, args);
    case "repair_frame":
      return repairFrame(ctx, args);
    case "repair_frame_range":
      return repairFrameRange(ctx, args);
    case "regenerate_region":
      return regenerateRegion(ctx, args);
    case "rerun_motion":
    case "recalculate_motion": {
      const { analyzeMotionAssist } = await import("./assist-tools");
      return analyzeMotionAssist(ctx, args);
    }
    case "extract_video":
      return extractVideo(ctx, args);
    case "render_preview":
    case "render_animation":
      return renderPreview(ctx, args);
    case "render_frame_range":
      return renderPreview(ctx, args);
    case "cancel_job": {
      const job = await repo.getJob(ctx.userId, str(args.jobId));
      if (!job) fail("FRAME_NOT_FOUND", "Job not found", 404);
      await repo.updateJob(job.id, { state: "cancelled", error_code: "JOB_CANCELLED" });
      return { id: job.id, state: "cancelled" };
    }
    case "list_mcp_clients":
      return repo.listMcpClients(ctx.userId);
    case "get_problem_ranges": {
      const { getProblemRangesCmd } = await import("./assist-tools");
      return getProblemRangesCmd(ctx, args);
    }
    case "create_repair_plan": {
      const { createRepairPlanCmd } = await import("./assist-tools");
      return createRepairPlanCmd(ctx, args);
    }
    case "suggest_repair": {
      const { suggestRepair } = await import("./assist-tools");
      return suggestRepair(ctx, args);
    }
    case "compare_before_after": {
      const { compareBeforeAfter } = await import("./assist-tools");
      return compareBeforeAfter(ctx, args);
    }
    case "execute_repair_plan": {
      requireConfirmedEdit("execute_repair_plan", args);
      const { executeRepairPlanCmd } = await import("./assist-tools");
      return executeRepairPlanCmd(ctx, args);
    }
    case "get_repair_plan": {
      const { getRepairPlanCmd } = await import("./assist-tools");
      return getRepairPlanCmd(ctx, args);
    }
    case "accept_revision": {
      const { acceptRevisionCmd } = await import("./assist-tools");
      return acceptRevisionCmd(ctx, args);
    }
    case "get_track": {
      const { getTrackCmd } = await import("./assist-tools");
      return getTrackCmd(ctx, args);
    }
    case "create_keyframe_pair": {
      const { createKeyframePairCmd } = await import("./inbetween-tools");
      return createKeyframePairCmd(ctx, args);
    }
    case "get_keyframe_pair": {
      const { getKeyframePairCmd } = await import("./inbetween-tools");
      return getKeyframePairCmd(ctx, args);
    }
    case "analyze_keyframe_transition": {
      const { analyzeKeyframeTransition } = await import("./inbetween-tools");
      return analyzeKeyframeTransition(ctx, args);
    }
    case "create_motion_plan": {
      const { createMotionPlanCmd } = await import("./inbetween-tools");
      return createMotionPlanCmd(ctx, args);
    }
    case "get_motion_plan": {
      const { getMotionPlanCmd } = await import("./inbetween-tools");
      return getMotionPlanCmd(ctx, args);
    }
    case "suggest_breakdown_frames": {
      const { suggestBreakdownFrames } = await import("./inbetween-tools");
      return suggestBreakdownFrames(ctx, args);
    }
    case "create_inbetween_plan": {
      const { createInbetweenPlanCmd } = await import("./inbetween-tools");
      return createInbetweenPlanCmd(ctx, args);
    }
    case "get_generation_job": {
      const { getGenerationJobCmd } = await import("./inbetween-tools");
      return getGenerationJobCmd(ctx, args);
    }
    case "get_candidate": {
      const { getCandidateCmd } = await import("./inbetween-tools");
      return getCandidateCmd(ctx, args);
    }
    case "list_candidates": {
      const { listCandidatesCmd } = await import("./inbetween-tools");
      return listCandidatesCmd(ctx, args);
    }
    case "evaluate_inbetweens": {
      const { evaluateInbetweensCmd } = await import("./inbetween-tools");
      return evaluateInbetweensCmd(ctx, args);
    }
    case "get_generated_issues": {
      const { getGeneratedIssuesCmd } = await import("./inbetween-tools");
      return getGeneratedIssuesCmd(ctx, args);
    }
    case "regenerate_inbetween_range": {
      requireConfirmedEdit("regenerate_inbetween_range", args);
      const { regenerateInbetweenRangeCmd } = await import("./inbetween-tools");
      return regenerateInbetweenRangeCmd(ctx, args);
    }
    case "accept_generated_frames": {
      requireConfirmedEdit("accept_generated_frames", args);
      const { acceptGeneratedFramesCmd } = await import("./inbetween-tools");
      return acceptGeneratedFramesCmd(ctx, args);
    }
    case "reject_generated_frames": {
      const { rejectGeneratedFramesCmd } = await import("./inbetween-tools");
      return rejectGeneratedFramesCmd(ctx, args);
    }
    case "export_frame_sequence": {
      const { exportFrameSequenceCmd } = await import("./inbetween-tools");
      return exportFrameSequenceCmd(ctx, args);
    }
    case "generate_breakdown_frame": {
      requireConfirmedEdit("generate_breakdown_frame", args);
      const { generateBreakdownFrameCmd } = await import("./inbetween-tools");
      return generateBreakdownFrameCmd(ctx, args);
    }
    case "get_generated_frame": {
      const { getGeneratedFrameCmd } = await import("./inbetween-tools");
      return getGeneratedFrameCmd(ctx, args);
    }
    case "set_frame_exposure": {
      const { setFrameExposureCmd } = await import("./inbetween-tools");
      return setFrameExposureCmd(ctx, args);
    }
    case "set_playback_fps":
      return setPlaybackFps(ctx, {
        projectId: str(args.projectId),
        fps: num(args.fps, DEFAULT_PLAYBACK_FPS),
      });
    default:
      fail("MCP_TOOL_ERROR", `Unknown tool: ${tool}`);
  }
}

async function analyzeFrame(ctx: CommandContext, args: Record<string, unknown>) {
  const frame = await loadOwnedFrame(ctx, args);
  const t = await ownTimeline(ctx, frame.timeline_id);
  const cacheKey = {
    frameHash: frame.content_hash,
    modelName: args.vlm ? "grok-vision" : "pixel-metrics",
    modelVersion: "0.2",
    configHash: str(args.prompt, "default"),
  };
  const cached = await repo.getAnalysisCache(cacheKey);
  if (cached) return { ...cached, cacheHit: true };
  const rgba = decodeJpegBase64(frame.image_data);
  const level1 = {
    luma: rgba.data.length ? undefined : 0,
    mae_self: 0,
    width: rgba.width,
    height: rgba.height,
    content_hash: frame.content_hash,
    provider: "pixel-metrics",
  };
  let vlm = null as unknown;
  if (args.vlm === true) {
    vlm = await analyzeFrameWithGrok({
      imageBase64: frame.image_data,
      prompt: str(args.prompt),
    });
  }
  const result = { frameId: frame.id, frameNumber: frame.frame_number, level1, vlm, timelineId: t.id };
  await repo.putAnalysisCache({ ...cacheKey, result });
  return result;
}

async function analyzeRange(ctx: CommandContext, args: Record<string, unknown>) {
  const t = await ownTimeline(ctx, str(args.timelineId));
  const frames = await repo.listFramesFull(t.id);
  if (frames.length === 0) return { results: [], jobId: null };
  const start = typeof args.startFrame === "number" ? args.startFrame : 0;
  const end =
    typeof args.endFrame === "number" ? args.endFrame : frames[frames.length - 1].frame_number;
  const wrapped = await withJob({
    userId: ctx.userId,
    projectId: t.project_id,
    type: "CONSISTENCY_ANALYSIS",
    payload: { timelineId: t.id, start, end },
    work: async (_id, progress) => {
      const slice = frames.filter((f) => f.frame_number >= start && f.frame_number <= end);
      const decoded = slice.map((f) => ({
        frameNumber: f.frame_number,
        frameId: f.id,
        rgba: decodeJpegBase64(f.image_data),
      }));
      await progress(20, { current: 0, total: slice.length, label: "評估一致性" });
      const pixel = scoreWindow(decoded);
      const { suggestRepair } = await import("./assist-tools");
      const assist = await suggestRepair(ctx, {
        timelineId: t.id,
        startFrame: start,
        endFrame: end,
        persistPlan: false,
        skipJob: true,
        sessionId: args.sessionId,
        region: args.region,
        characterId: args.characterId,
      });
      await progress(80, { current: slice.length, total: slice.length, label: "評估一致性" });
      const tracking = await repo.listTrackingPoints(t.project_id);
      const contacts = detectContactBreaks(tracking);
      for (const c of contacts) {
        await repo.insertEdge({
          projectId: t.project_id,
          edgeType: "CONTACTS",
          fromKind: "track",
          fromId: c.pair[0],
          toKind: "track",
          toId: c.pair[1],
          payload: {
            frame: c.frame,
            distance: c.distance,
            note: c.note,
          },
        });
      }
      // Consistency Engine fuses assist scores; keep pixel as fallback keys only.
      return {
        pixel,
        assist,
        contacts: contacts.length,
        note: "Consistency Engine fuses motion / pose / tracking / contact. Pixel scores are fallback only.",
      };
    },
    summarize: (r) => ({
      problems: r.assist.problems.length,
      ranges: r.assist.problem_ranges.length,
    }),
  });
  return { ...wrapped.result, jobId: wrapped.jobId };
}

async function analyzeMotion(ctx: CommandContext, args: Record<string, unknown>) {
  const t = await ownTimeline(ctx, str(args.timelineId));
  const providerName = typeof args.provider === "string" ? args.provider : "block-match-16";
  const flow = getOpticalFlow(providerName);
  if (!flow.available()) {
    fail("MODEL_NOT_AVAILABLE", `${flow.id} is not loaded. Use provider=block-match-16.`);
  }
  const wrapped = await withJob({
    userId: ctx.userId,
    projectId: t.project_id,
    type: "OPTICAL_FLOW",
    payload: { timelineId: t.id, provider: flow.id },
    provider: flow.id,
    model: flow.id,
    work: async (_id, progress) => {
      const frames = await repo.listFramesFull(t.id);
      const out: Array<{
        frameNumber: number;
        magnitude: number;
        direction: number;
        diff: number;
      }> = [];
      for (let i = 1; i < frames.length; i += 1) {
        const a = decodeJpegBase64(frames[i - 1].image_data);
        const b = decodeJpegBase64(frames[i].image_data);
        const run = await flow.flow(a, b);
        if (!run.ok) fail("MODEL_NOT_AVAILABLE", run.error);
        out.push({
          frameNumber: frames[i].frame_number,
          magnitude: run.data.magnitude,
          direction: run.data.direction,
          diff: meanAbsDiff(a, b),
        });
        await progress(Math.round((i / Math.max(1, frames.length - 1)) * 90), {
          current: i,
          total: frames.length - 1,
          label: "分析運動",
        });
      }
      await repo.replaceMotionData(
        t.id,
        out.map((s, i) => ({
          frameNumber: s.frameNumber,
          magnitude: s.magnitude,
          direction: s.direction,
          diff: s.diff,
          frameA: frames[i].frame_number,
          frameB: s.frameNumber,
        })),
        flow.id,
      );
      return { provider: flow.id, samples: out };
    },
    summarize: (r) => ({ samples: r.samples.length, provider: r.provider }),
  });
  return { ...wrapped.result, jobId: wrapped.jobId };
}

async function analyzeTracking(ctx: CommandContext, args: Record<string, unknown>) {
  const t = await ownTimeline(ctx, str(args.timelineId));
  const providerName = typeof args.provider === "string" ? args.provider : "framelab-ncc";
  const tracker = getPointTracker(providerName);
  if (!tracker.available()) {
    fail(
      "MODEL_NOT_AVAILABLE",
      `${tracker.id} is not loaded. Use provider=framelab-ncc (NCC template matching).`,
    );
  }
  const nameFilter = typeof args.name === "string" ? args.name : null;
  const wrapped = await withJob({
    userId: ctx.userId,
    projectId: t.project_id,
    type: "POINT_TRACKING",
    payload: { timelineId: t.id, provider: tracker.id, name: nameFilter },
    provider: tracker.id,
    model: tracker.id,
    work: async (_id, progress) => {
      const frames = await repo.listFramesFull(t.id);
      if (frames.length === 0) return { provider: tracker.id, tracks: [] as unknown[] };
      const decoded = frames.map((f) => decodeJpegBase64(f.image_data));
      const seeds = await repo.listTrackingPoints(t.project_id);
      const byName = new Map<string, typeof seeds>();
      for (const p of seeds) {
        if (nameFilter && p.name !== nameFilter) continue;
        const list = byName.get(p.name) ?? [];
        list.push(p);
        byName.set(p.name, list);
      }
      if (byName.size === 0) {
        return {
          provider: tracker.id,
          tracks: [],
          note: "No tracking seed. Click the canvas or call create_tracking_point first.",
        };
      }
      const tracks = [];
      let i = 0;
      for (const [name, list] of byName) {
        const seed = [...list].sort((a, b) => a.frame_number - b.frame_number)[0];
        const seedIndex = frames.findIndex((f) => f.frame_number === seed.frame_number);
        if (seedIndex < 0) continue;
        const run = await tracker.track({
          frames: decoded,
          seed: { x: seed.x, y: seed.y, frameIndex: seedIndex },
        });
        if (!run.ok) fail("MODEL_NOT_AVAILABLE", run.error);
        await repo.deleteTrackEdgesForName(t.project_id, name);
        await repo.deleteTrackingPointsByName(t.project_id, name);
        let prev: { id: string; x: number; y: number; frame: number } | null = null;
        for (const s of run.data) {
          const frameNumber = frames[s.frameIndex]?.frame_number;
          if (frameNumber == null) continue;
          const id = nid("trk");
          const status = canonicalTrackStatus(s.status);
          await repo.insertTrackingPoint({
            id,
            projectId: t.project_id,
            name,
            x: Math.round(s.x),
            y: Math.round(s.y),
            frameNumber,
            score: s.score,
            status,
            trackId: name,
          });
          if (prev) {
            await repo.insertEdge({
              projectId: t.project_id,
              edgeType: "TRACKS_TO",
              fromKind: "track",
              fromId: prev.id,
              toKind: "track",
              toId: id,
              payload: { name, fromFrame: prev.frame, toFrame: frameNumber },
            });
            await repo.insertEdge({
              projectId: t.project_id,
              edgeType: "MOVES_TO",
              fromKind: "track",
              fromId: prev.id,
              toKind: "track",
              toId: id,
              payload: {
                name,
                dx: Math.round(s.x) - prev.x,
                dy: Math.round(s.y) - prev.y,
                fromFrame: prev.frame,
                toFrame: frameNumber,
                status,
              },
            });
          }
          prev = { id, x: Math.round(s.x), y: Math.round(s.y), frame: frameNumber };
        }
        tracks.push({ name, samples: run.data.length });
        i += 1;
        await progress(Math.round((i / Math.max(1, byName.size)) * 90), {
          current: i,
          total: byName.size,
          label: "分析追蹤",
        });
      }
      return { provider: tracker.id, tracks };
    },
    summarize: (r) => ({ tracks: r.tracks.length, provider: r.provider }),
  });
  return { ...wrapped.result, jobId: wrapped.jobId };
}

async function compareFrames(ctx: CommandContext, args: Record<string, unknown>) {
  let timelineId = str(args.timelineId);
  if (!timelineId && typeof args.sessionId === "string") {
    const session = await repo.getWorkspaceSession(ctx.userId, args.sessionId);
    timelineId = session?.timeline_id ?? "";
  }
  if (!timelineId) fail("VALIDATION_ERROR", "timelineId required");
  const t = await ownTimeline(ctx, timelineId);
  const a = await repo.getFrameByNumber(t.id, num(args.frameA));
  const b = await repo.getFrameByNumber(t.id, num(args.frameB));
  if (!a || !b) fail("FRAME_NOT_FOUND", "Compare frames missing", 404);
  let ra = decodeJpegBase64(a.image_data);
  let rb = decodeJpegBase64(b.image_data);
  const rx = num(args.x);
  const ry = num(args.y);
  const rw = num(args.w);
  const rh = num(args.h);
  const hasRegion = rw > 0 && rh > 0;
  if (hasRegion) {
    const box: RegionBox =
      rw <= 1 && rh <= 1
        ? {
            x: rx * a.width,
            y: ry * a.height,
            w: rw * a.width,
            h: rh * a.height,
          }
        : { x: rx, y: ry, w: rw, h: rh };
    ra = cropRgba(ra, box);
    rb = cropRgba(rb, box);
  }
  const ca = lumaCentroid(ra);
  const cb = lumaCentroid(rb);
  return {
    kind: "lightweight visual analysis",
    frameA: a.frame_number,
    frameB: b.frame_number,
    mae: meanAbsDiff(ra, rb),
    histogramDistance: histogramDistance(histogram16(ra), histogram16(rb)),
    ssim_like: ssimLike(ra, rb),
    edge_delta: Math.abs(edgeMagnitude(ra) - edgeMagnitude(rb)),
    centroid_displacement: Math.hypot(ca.x - cb.x, ca.y - cb.y),
    motion: motionField(ra, rb),
    region: hasRegion ? { x: rx, y: ry, w: rw, h: rh } : null,
    note: "Pixel MAE / histogram / luma-SSIM stand-in / 16×16 block match. Not pose, not SEA-RAFT.",
  };
}

async function setType(ctx: CommandContext, args: Record<string, unknown>, typeRaw: string) {
  if (!isFrameType(typeRaw)) {
    fail("VALIDATION_ERROR", `Invalid frame type ${typeRaw}. Allowed: ${FRAME_TYPES.join(", ")}`);
  }
  const frame = await loadOwnedFrame(ctx, args);
  const t = await ownTimeline(ctx, frame.timeline_id);
  const prev = snapshotFrame(frame);
  await repo.updateFrame(frame.id, { frame_type: typeRaw });
  if (typeRaw === "KEY" || typeRaw === "BREAKDOWN") {
    await repo.upsertKeyframe({
      timelineId: frame.timeline_id,
      frameId: frame.id,
      kind: typeRaw,
      locked: frame.is_locked,
    });
  } else {
    await repo.deleteKeyframeForFrame(frame.id);
  }
  await recordRevision(ctx, "set_frame_type", t.project_id, frame.id, prev, {
    ...prev,
    frameType: typeRaw,
  });
  return { id: frame.id, frameType: typeRaw };
}

async function setDuration(ctx: CommandContext, args: Record<string, unknown>) {
  const frame = await loadOwnedFrame(ctx, args);
  const t = await ownTimeline(ctx, frame.timeline_id);
  const durationMs = Math.max(1, Math.round(num(args.durationMs)));
  const prev = snapshotFrame(frame);
  await repo.updateFrame(frame.id, { duration_ms: durationMs });
  await recordRevision(ctx, "set_frame_duration", t.project_id, frame.id, prev, {
    ...prev,
    durationMs,
  });
  return { id: frame.id, durationMs };
}

async function setNotes(ctx: CommandContext, args: Record<string, unknown>) {
  const frame = await loadOwnedFrame(ctx, args);
  const t = await ownTimeline(ctx, frame.timeline_id);
  const notes = typeof args.notes === "string" ? args.notes : "";
  const prev = snapshotFrame(frame);
  await repo.updateFrame(frame.id, { notes });
  await recordRevision(ctx, "set_frame_notes", t.project_id, frame.id, prev, { notes });
  return { id: frame.id, notes };
}

async function setLocked(ctx: CommandContext, args: Record<string, unknown>, locked: boolean) {
  const frame = await loadOwnedFrame(ctx, args);
  const t = await ownTimeline(ctx, frame.timeline_id);
  const prev = snapshotFrame(frame);
  await repo.updateFrame(frame.id, { is_locked: locked });
  await recordRevision(ctx, locked ? "lock_keyframe" : "unlock_keyframe", t.project_id, frame.id, prev, {
    ...prev,
    isLocked: locked,
  });
  return { id: frame.id, isLocked: locked };
}

async function replaceFrame(ctx: CommandContext, args: Record<string, unknown>) {
  const frame = await loadOwnedFrame(ctx, args);
  const t = await ownTimeline(ctx, frame.timeline_id);
  const imageData = str(args.imageData);
  if (!imageData) fail("VALIDATION_ERROR", "imageData required");
  const prev = snapshotFrame(frame);
  const rgba = decodeJpegBase64(imageData);
  const thumbnailData = makeThumbnail(rgba);
  const contentHash = hashBytes(imageData);
  await repo.updateFrame(frame.id, {
    image_data: imageData,
    thumbnail_data: thumbnailData,
    content_hash: contentHash,
    width: rgba.width,
    height: rgba.height,
  });
  const revisionId = await recordRevision(ctx, "replace_frame", t.project_id, frame.id, prev, {
    contentHash,
  });
  return { id: frame.id, revisionId };
}

async function detectKeyframes(ctx: CommandContext, args: Record<string, unknown>) {
  const t = await ownTimeline(ctx, str(args.timelineId));
  const frames = await repo.listFramesFull(t.id);
  const diffs: number[] = [0];
  for (let i = 1; i < frames.length; i += 1) {
    diffs.push(meanAbsDiff(decodeJpegBase64(frames[i - 1].image_data), decodeJpegBase64(frames[i].image_data)));
  }
  const marked: number[] = [];
  for (let i = 1; i < diffs.length - 1; i += 1) {
    if (diffs[i] > diffs[i - 1] && diffs[i] > diffs[i + 1] && diffs[i] > 8) {
      await repo.updateFrame(frames[i].id, { frame_type: "KEY" });
      await repo.upsertKeyframe({
        timelineId: t.id,
        frameId: frames[i].id,
        kind: "KEY",
        locked: frames[i].is_locked,
      });
      marked.push(frames[i].frame_number);
    }
  }
  return { marked };
}

async function interpolateFrames(ctx: CommandContext, args: Record<string, unknown>) {
  const t = await ownTimeline(ctx, str(args.timelineId));
  const interpolator = getInterpolation(str(args.provider, "linear-blend"));
  if (!interpolator.available()) {
    fail("PROVIDER_NOT_AVAILABLE", `${interpolator.id} is not loaded. Use provider=linear-blend.`);
  }
  const a = await repo.getFrameByNumber(t.id, num(args.frameA));
  const b = await repo.getFrameByNumber(t.id, num(args.frameB));
  if (!a || !b) fail("FRAME_NOT_FOUND", "Boundary frames missing", 404);
  const count = Math.max(1, num(args.count, Math.max(1, b.frame_number - a.frame_number - 1)));
  const generated = await interpolator.interpolate(
    decodeJpegBase64(a.image_data),
    decodeJpegBase64(b.image_data),
    count,
    { curve: (str(args.curve, "linear") as "linear") },
  );
  const written: number[] = [];
  for (let i = 0; i < generated.length; i += 1) {
    const n = a.frame_number + i + 1;
    if (n >= b.frame_number) break;
    const existing = await repo.getFrameByNumber(t.id, n);
    if (!existing || existing.is_locked || existing.frame_type === "KEY") continue;
    const imageData = encodeJpegBase64(generated[i], 80);
    await recordRevision(
      ctx,
      "interpolate_frames",
      t.project_id,
      existing.id,
      snapshotFrame(existing),
      { contentHash: hashBytes(imageData) },
      { timelineId: t.id, startFrame: a.frame_number, endFrame: b.frame_number },
    );
    await repo.updateFrame(existing.id, {
      image_data: imageData,
      thumbnail_data: makeThumbnail(generated[i]),
      content_hash: hashBytes(imageData),
      frame_type: "INBETWEEN",
    });
    written.push(n);
  }
  return { written, provider: interpolator.id, interpolation: "FULL_FRAME_INTERPOLATION" };
}

async function repairFrame(ctx: CommandContext, args: Record<string, unknown>) {
  const frame = await loadOwnedFrame(ctx, args);
  if (str(args.method, "blend") === "generative") {
    fail("PROVIDER_NOT_AVAILABLE", "Generative repair is not loaded.");
  }
  const t = await ownTimeline(ctx, frame.timeline_id);
  const prev = await repo.getFrameByNumber(t.id, frame.frame_number - 1);
  const next = await repo.getFrameByNumber(t.id, frame.frame_number + 1);
  if (!prev || !next) fail("FRAME_NOT_FOUND", "Neighborhood frames missing", 404);
  const interpolator = getInterpolation("linear-blend");
  const [mid] = await interpolator.interpolate(
    decodeJpegBase64(prev.image_data),
    decodeJpegBase64(next.image_data),
    1,
    { curve: "linear" },
  );
  const snap = snapshotFrame(frame);
  const imageData = encodeJpegBase64(mid, 80);
  const revisionId = await recordRevision(ctx, "repair_frame", t.project_id, frame.id, snap, {
    contentHash: hashBytes(imageData),
  });
  await repo.updateFrame(frame.id, {
    image_data: imageData,
    thumbnail_data: makeThumbnail(mid),
    content_hash: hashBytes(imageData),
    frame_type: "REPAIRED",
  });
  return { id: frame.id, revisionId, interpolation: "FULL_FRAME_INTERPOLATION" };
}

async function repairFrameRange(ctx: CommandContext, args: Record<string, unknown>) {
  const t = await ownTimeline(ctx, str(args.timelineId));
  const start = num(args.startFrame);
  const end = num(args.endFrame);
  const interpolator = getInterpolation("linear-blend");
  const wrapped = await withJob({
    userId: ctx.userId,
    projectId: t.project_id,
    type: "REPAIR_INTERPOLATION",
    payload: { timelineId: t.id, start, end },
    provider: interpolator.id,
    model: interpolator.id,
    work: async (_id, progress) => {
      const a = await repo.getFrameByNumber(t.id, start);
      const b = await repo.getFrameByNumber(t.id, end);
      if (!a || !b) fail("FRAME_NOT_FOUND", "Repair boundary frames missing", 404);
      const interior: number[] = [];
      for (let n = start + 1; n < end; n += 1) interior.push(n);
      const generated = await interpolator.interpolate(
        decodeJpegBase64(a.image_data),
        decodeJpegBase64(b.image_data),
        Math.max(1, interior.length),
        { curve: "ease_in_out" },
      );
      const repaired: number[] = [];
      for (let i = 0; i < interior.length; i += 1) {
        const frame = await repo.getFrameByNumber(t.id, interior[i]);
        if (!frame || frame.is_locked || frame.frame_type === "KEY") continue;
        const imageData = encodeJpegBase64(generated[i] ?? generated[generated.length - 1], 80);
        await recordRevision(
          ctx,
          "repair_frame_range",
          t.project_id,
          frame.id,
          snapshotFrame(frame),
          { contentHash: hashBytes(imageData) },
          { timelineId: t.id, startFrame: interior[0], endFrame: interior[interior.length - 1] },
        );
        await repo.updateFrame(frame.id, {
          image_data: imageData,
          thumbnail_data: makeThumbnail(generated[i] ?? generated[0]),
          content_hash: hashBytes(imageData),
          frame_type: "REPAIRED",
        });
        repaired.push(interior[i]);
        await progress(Math.round(((i + 1) / Math.max(1, interior.length)) * 90), {
          current: i + 1,
          total: interior.length,
          label: "修復插值",
        });
      }
      return { repaired, provider: interpolator.id };
    },
    summarize: (r) => ({ repaired: r.repaired.length }),
  });
  return { ...wrapped.result, jobId: wrapped.jobId };
}

async function regenerateRegion(ctx: CommandContext, args: Record<string, unknown>) {
  const frame = await loadOwnedFrame(ctx, args);
  if (str(args.method) === "generative") {
    fail("PROVIDER_NOT_AVAILABLE", "Generative region repair is not loaded.");
  }
  const x = num(args.x);
  const y = num(args.y);
  const w = num(args.w);
  const h = num(args.h);
  if (w <= 0 || h <= 0) {
    fail("MODEL_NOT_AVAILABLE", "Named regions without a bbox need SAM2 → MODEL_NOT_AVAILABLE.");
  }
  const t = await ownTimeline(ctx, frame.timeline_id);
  const prev = await repo.getFrameByNumber(t.id, frame.frame_number - 1);
  const next = await repo.getFrameByNumber(t.id, frame.frame_number + 1);
  if (!prev || !next) fail("FRAME_NOT_FOUND", "Neighborhood frames missing", 404);
  const interpolator = getInterpolation("linear-blend");
  const [mid] = await interpolator.interpolate(
    decodeJpegBase64(prev.image_data),
    decodeJpegBase64(next.image_data),
    1,
    { curve: "linear", region: { x, y, w, h } },
  );
  const base = decodeJpegBase64(frame.image_data);
  const box = { x, y, w, h };
  const patch = cropRgba(mid, box);
  for (let row = 0; row < patch.height; row += 1) {
    for (let col = 0; col < patch.width; col += 1) {
      const di = ((Math.round(y) + row) * base.width + (Math.round(x) + col)) * 4;
      const si = (row * patch.width + col) * 4;
      if (di < 0 || di + 3 >= base.data.length) continue;
      base.data[di] = patch.data[si];
      base.data[di + 1] = patch.data[si + 1];
      base.data[di + 2] = patch.data[si + 2];
      base.data[di + 3] = 255;
    }
  }
  const imageData = encodeJpegBase64(base, 80);
  const snap = snapshotFrame(frame);
  const revisionId = await recordRevision(ctx, "regenerate_region", t.project_id, frame.id, snap, {
    box,
  });
  await repo.updateFrame(frame.id, {
    image_data: imageData,
    thumbnail_data: makeThumbnail(base),
    content_hash: hashBytes(imageData),
    frame_type: "REPAIRED",
  });
  return { id: frame.id, revisionId, interpolation: "FULL_FRAME_INTERPOLATION" };
}

async function createTrackingPoint(ctx: CommandContext, args: Record<string, unknown>) {
  const project = await ownProject(ctx, str(args.projectId));
  const id = nid("trk");
  const name = str(args.name);
  const x = num(args.x);
  const y = num(args.y);
  const frameNumber = num(args.frameNumber);
  await repo.insertTrackingPoint({
    id,
    projectId: project.id,
    name,
    x,
    y,
    frameNumber,
    score: 1,
    status: "VISIBLE",
    trackId: name,
  });
  if (args.track !== false) {
    const timelines = await repo.listTimelines(project.id);
    const timelineId = timelines[0]?.id;
    if (timelineId) {
      await analyzeTracking(ctx, { timelineId, name, provider: args.provider });
    }
  }
  return { id, name, x, y, frameNumber };
}

async function undoFrame(ctx: CommandContext, args: Record<string, unknown>) {
  if (typeof args.revisionId === "string" && args.revisionId) {
    return restoreRevision(ctx, args.revisionId);
  }
  const projectId = str(args.projectId);
  await ownProject(ctx, projectId);
  const revs = await repo.listRevisions(projectId, typeof args.frameId === "string" ? args.frameId : undefined);
  const latest = revs.find((r) => r.status !== "reverted") ?? revs[0];
  if (!latest) fail("FRAME_NOT_FOUND", "No revision to undo", 404);
  return restoreRevision(ctx, latest.id);
}

async function redoFrame(ctx: CommandContext, args: Record<string, unknown>) {
  const projectId = str(args.projectId);
  await ownProject(ctx, projectId);
  const revs = await repo.listRevisions(projectId, typeof args.frameId === "string" ? args.frameId : undefined);
  const undone = revs.find((r) => r.status === "reverted");
  if (!undone) fail("FRAME_NOT_FOUND", "No undone revision to redo", 404);
  const next = JSON.parse(undone.new_json || "{}") as Record<string, unknown>;
  const { isTimelineEdit, applyTimelineEdit } = await import("./timeline-edit");
  if (isTimelineEdit(next)) {
    await applyTimelineEdit(ctx, next, "redo");
    await repo.updateRevisionStatus(undone.id, "open");
    return { id: undone.id, status: "open" };
  }
  if (!undone.frame_id || typeof next.imageData !== "string" || !next.imageData) {
    fail("FRAME_NOT_FOUND", "Redo snapshot missing", 404);
  }
  await repo.updateFrame(undone.frame_id, {
    image_data: String(next.imageData),
    thumbnail_data: typeof next.thumbnailData === "string" ? next.thumbnailData : "",
    content_hash: typeof next.contentHash === "string" ? next.contentHash : hashBytes(String(next.imageData)),
    frame_type: typeof next.frameType === "string" ? next.frameType : undefined,
  });
  await repo.updateRevisionStatus(undone.id, "open");
  return { id: undone.id, status: "open" };
}

export async function restoreRevision(ctx: CommandContext, revisionId: string) {
  const rev = await repo.getRevision(revisionId);
  if (!rev) fail("FRAME_NOT_FOUND", "Revision not found", 404);
  await ownProject(ctx, rev.project_id);
  const prev = JSON.parse(rev.previous_json || "{}") as Record<string, unknown>;
  const { isTimelineEdit, applyTimelineEdit } = await import("./timeline-edit");
  if (isTimelineEdit(prev)) {
    await applyTimelineEdit(ctx, prev, "undo");
    await repo.updateRevisionStatus(revisionId, "reverted");
    return { id: revisionId, status: "reverted" };
  }
  const typed = prev as {
    imageData?: string;
    thumbnailData?: string;
    contentHash?: string;
    frameType?: string;
    durationMs?: number;
    notes?: string;
    originalAsset?: string | null;
    activeAsset?: string | null;
    fullAsset?: string | null;
    previewAsset?: string | null;
    thumbnailAsset?: string | null;
    frames?: Array<{
      frameId: string;
      imageData: string;
      thumbnailData?: string;
      contentHash?: string;
      frameType?: string;
      durationMs?: number;
      notes?: string;
      originalAsset?: string | null;
      activeAsset?: string | null;
      fullAsset?: string | null;
      previewAsset?: string | null;
      thumbnailAsset?: string | null;
    }>;
  };
  const apply = async (
    frameId: string,
    snap: {
      imageData?: string;
      thumbnailData?: string;
      contentHash?: string;
      frameType?: string;
      durationMs?: number;
      notes?: string;
      originalAsset?: string | null;
      activeAsset?: string | null;
      fullAsset?: string | null;
      previewAsset?: string | null;
      thumbnailAsset?: string | null;
    },
  ) => {
    if (snap.fullAsset) {
      await repo.updateFrame(frameId, {
        content_hash: snap.contentHash,
        frame_type: snap.frameType,
        duration_ms: snap.durationMs,
        notes: snap.notes,
        original_asset: snap.originalAsset ?? undefined,
        active_asset: snap.activeAsset ?? snap.originalAsset ?? undefined,
        full_asset: snap.fullAsset,
        preview_asset: snap.previewAsset ?? undefined,
        thumbnail_asset: snap.thumbnailAsset ?? undefined,
      });
      return;
    }
    if (!snap.imageData) return;
    await repo.updateFrame(frameId, {
      image_data: snap.imageData,
      thumbnail_data: snap.thumbnailData ?? "",
      content_hash: snap.contentHash ?? hashBytes(snap.imageData),
      frame_type: snap.frameType,
      duration_ms: snap.durationMs,
      notes: snap.notes,
      original_asset: snap.originalAsset ?? undefined,
      active_asset: snap.activeAsset ?? snap.originalAsset ?? undefined,
    });
  };
  if (Array.isArray(typed.frames) && typed.frames.length) {
    for (const f of typed.frames) {
      await apply(f.frameId, f);
    }
  } else if (rev.frame_id) {
    await apply(rev.frame_id, typed);
  }
  await repo.updateRevisionStatus(revisionId, "reverted");
  return { id: revisionId, status: "reverted" };
}

async function renderPreview(ctx: CommandContext, args: Record<string, unknown>) {
  const t = await ownTimeline(ctx, str(args.timelineId));
  const frames = await repo.listFramesFull(t.id);
  const start = typeof args.startFrame === "number" ? args.startFrame : frames[0]?.frame_number ?? 0;
  const end = typeof args.endFrame === "number" ? args.endFrame : frames[frames.length - 1]?.frame_number ?? 0;
  const slice = frames.filter((f) => f.frame_number >= start && f.frame_number <= end);
  const wrapped = await withJob({
    userId: ctx.userId,
    projectId: t.project_id,
    type: "RENDER",
    payload: { timelineId: t.id, start, end },
    work: async () => {
      return concatJpegSequence({
        projectId: t.project_id,
        fps: t.fps,
        frames: slice.map((f) => ({ frameNumber: f.frame_number, imageData: f.image_data })),
      });
    },
    summarize: (r) => ({ outputPath: r.outputPath, frameCount: r.frameCount }),
  });
  return { ...wrapped.result, jobId: wrapped.jobId };
}

async function extractVideo(ctx: CommandContext, args: Record<string, unknown>) {
  const video = await repo.getVideo(str(args.videoId));
  if (!video) fail("FRAME_NOT_FOUND", "Video not found", 404);
  await ownProject(ctx, video.project_id);
  const extract = parseFpsField(
    typeof args.fps === "number" || typeof args.fps === "string" ? args.fps : "auto",
  );
  return extractAndIngestUploadedVideo(ctx, {
    filename: video.filename,
    mimeType: video.mime_type,
    bytes: null,
    fps: extract === "auto" ? 0 : extract,
    playbackFps:
      typeof args.playbackFps === "string" || typeof args.playbackFps === "number"
        ? args.playbackFps
        : "same",
    name: video.filename,
    existingVideoId: video.id,
    sourcePath: video.source_path,
  });
}

export async function createBlankProject(
  ctx: CommandContext,
  data: { name: string; fps?: number },
) {
  const now = new Date().toISOString();
  const id = nid("prj");
  const timelineId = nid("tl");
  await repo.insertProject({
    id,
    user_id: ctx.userId,
    name: data.name || "Untitled",
    description: "",
    fps: data.fps ?? DEFAULT_PLAYBACK_FPS,
    width: 480,
    height: 270,
    created_at: now,
    updated_at: now,
  });
  await repo.insertTimeline({
    id: timelineId,
    project_id: id,
    video_id: null,
    name: "Timeline",
    fps: data.fps ?? DEFAULT_PLAYBACK_FPS,
    frame_count: 0,
    created_at: now,
  });
  await ensureProjectLayout(id);
  return { id, timelineId, name: data.name, projectId: id };
}

export async function setPlaybackFps(
  ctx: CommandContext,
  data: { projectId: string; fps: number },
) {
  const project = await ownProject(ctx, data.projectId);
  const fps = resolvePlaybackFps(data.fps, DEFAULT_PLAYBACK_FPS);
  await repo.updateProjectFps(project.id, fps);
  const timelines = await repo.listTimelines(project.id);
  for (const t of timelines) {
    await repo.updateTimelineFps(t.id, fps);
    const frames = await repo.listFramesMeta(t.id);
    for (const f of frames) {
      await repo.updateFrame(f.id, {
        duration_ms: frameDurationMs(fps, f.exposure_count ?? 1),
      });
    }
  }
  return { projectId: project.id, fps };
}

export async function createSampleProject(ctx: CommandContext, name?: string) {
  const created = await createBlankProject(ctx, { name: name || "Bouncing ball", fps: 24 });
  const frames = generateBouncingBall({ frames: 24, fps: 24 });
  for (const f of frames) {
    await repo.insertFrame({
      id: nid("frm"),
      timeline_id: created.timelineId,
      frame_number: f.frameNumber,
      timestamp_ms: f.timestampMs,
      duration_ms: f.durationMs,
      frame_type: f.frameType,
      image_data: f.imageData,
      thumbnail_data: f.thumbnailData,
      width: f.width,
      height: f.height,
      content_hash: f.contentHash,
      notes: f.notes,
    });
    if (f.frameType === "KEY" || f.frameType === "BREAKDOWN") {
      const row = await repo.getFrameByNumber(created.timelineId, f.frameNumber);
      if (row) {
        await repo.upsertKeyframe({
          timelineId: created.timelineId,
          frameId: row.id,
          kind: f.frameType,
          locked: false,
        });
      }
    }
  }
  await repo.setTimelineFrameCount(created.timelineId, frames.length);
  const inserted = await repo.listFramesMeta(created.timelineId);
  for (const e of sequentialEdges(
    inserted.map((f) => ({
      id: f.id,
      timelineId: f.timeline_id,
      frameNumber: f.frame_number,
      timestampMs: f.timestamp_ms,
      durationMs: f.duration_ms,
      frameType: f.frame_type as FrameType,
      imageData: "",
      thumbnailData: "",
      width: f.width,
      height: f.height,
      isLocked: f.is_locked,
      notes: f.notes,
      contentHash: f.content_hash,
    })),
  )) {
    await repo.insertEdge({
      projectId: created.id,
      edgeType: e.type,
      fromKind: e.fromKind,
      fromId: e.fromId,
      toKind: e.toKind,
      toId: e.toId,
      payload: e.payload,
    });
  }
  return created;
}

export async function ingestFrames(
  ctx: CommandContext,
  data: {
    name?: string;
    fps: number;
    frames: { imageData: string; frameNumber: number }[];
    projectId?: string;
    /** Default true: wipe the timeline first. False appends a chunk. */
    replace?: boolean;
  },
) {
  // A caller-supplied projectId used to be trusted outright, and the very next
  // thing this function does is delete every existing frame of that project --
  // so any authenticated user could wipe and overwrite another tenant's
  // timeline. Prove ownership (and token scope) before touching it.
  const created = data.projectId
    ? {
        id: (await ownProject(ctx, data.projectId)).id,
        timelineId: (await repo.listTimelines(data.projectId))[0]?.id,
      }
    : await createBlankProject(ctx, { name: data.name || "Imported", fps: data.fps });
  if (!created.timelineId) fail("FRAME_NOT_FOUND", "Timeline missing", 404);
  if (data.replace !== false) {
    const existing = await repo.listFramesMeta(created.timelineId);
    for (const f of existing) await repo.deleteFrameRow(f.id);
  }
  for (const f of data.frames) {
    const rgba = decodeJpegBase64(f.imageData);
    await repo.insertFrame({
      id: nid("frm"),
      timeline_id: created.timelineId,
      frame_number: f.frameNumber,
      timestamp_ms: Math.round((f.frameNumber / Math.max(1, data.fps)) * 1000),
      duration_ms: frameDurationMs(data.fps, 1),
      frame_type: "INBETWEEN",
      image_data: f.imageData,
      thumbnail_data: makeThumbnail(rgba),
      width: rgba.width,
      height: rgba.height,
      content_hash: hashBytes(f.imageData),
    });
  }
  const all = await repo.listFramesMeta(created.timelineId);
  await repo.setTimelineFrameCount(created.timelineId, all.length);
  return {
    projectId: created.id,
    timelineId: created.timelineId,
    frames: data.frames.length,
    frameCount: all.length,
  };
}

/** Ingest extracted JPEGs from disk one file at a time — never a giant base64 array. */
export async function ingestJpegFiles(
  ctx: CommandContext,
  data: {
    projectId: string;
    fps: number;
    extractFps?: number;
    files: string[];
    onProgress?: (done: number, total: number) => Promise<void> | void;
  },
) {
  const created = {
    id: (await ownProject(ctx, data.projectId)).id,
    timelineId: (await repo.listTimelines(data.projectId))[0]?.id,
  };
  if (!created.timelineId) fail("FRAME_NOT_FOUND", "Timeline missing", 404);
  const existing = await repo.listFramesMeta(created.timelineId);
  for (const f of existing) await repo.deleteFrameRow(f.id);
  const stampFps = data.extractFps && data.extractFps > 0 ? data.extractFps : data.fps;
  let count = 0;
  for (const file of data.files) {
    const imageData = await readJpegFileAsBase64(file);
    const rgba = decodeJpegBase64(imageData);
    await repo.insertFrame({
      id: nid("frm"),
      timeline_id: created.timelineId,
      frame_number: count,
      timestamp_ms: Math.round((count / Math.max(1, stampFps)) * 1000),
      duration_ms: frameDurationMs(data.fps, 1),
      frame_type: "INBETWEEN",
      image_data: imageData,
      thumbnail_data: makeThumbnail(rgba),
      width: rgba.width,
      height: rgba.height,
      content_hash: hashBytes(imageData),
    });
    count += 1;
    await data.onProgress?.(count, data.files.length);
  }
  await repo.setTimelineFrameCount(created.timelineId, count);
  return { projectId: created.id, timelineId: created.timelineId, frames: count, frameCount: count };
}

export async function startUploadedVideoIngest(
  ctx: CommandContext,
  opts: {
    filename: string;
    mimeType: string;
    bytes: Buffer | null;
    fps: number;
    playbackFps?: number | string;
    name: string;
    existingVideoId?: string;
    sourcePath?: string;
  },
) {
  const created = await createBlankProject(ctx, { name: opts.name, fps: DEFAULT_PLAYBACK_FPS });
  await ensureProjectLayout(created.id);
  const videoId = opts.existingVideoId ?? nid("vid");
  const sourceName = opts.filename.replace(/[^a-zA-Z0-9._-]+/g, "_") || "upload.mp4";
  let sourcePath = opts.sourcePath ?? "";
  if (opts.bytes) {
    sourcePath = await putBytes(created.id, "source", sourceName, opts.bytes);
  }
  if (!sourcePath) fail("VALIDATION_ERROR", "沒有來源影片");
  const outDir = `${projectRoot(created.id)}/frames/extract`;
  const handle = await startJob({
    userId: ctx.userId,
    projectId: created.id,
    type: "FRAME_EXTRACTION",
    payload: { filename: opts.filename, fps: opts.fps },
    provider: "ffmpeg",
    model: "ffmpeg-extract",
    device: "cpu",
    work: async (_jobId, progress) => {
      await progress(2, { label: "正在拆幀…", current: 0, total: 0 });
      const extracted = await extractFramesWithFfmpeg({
        inputPath: sourcePath,
        outputDir: outDir,
        fps: opts.fps > 0 ? opts.fps : 0,
        maxWidth: 640,
        maxFrames: 0,
      });
      const extractFps = resolveExtractFps(opts.fps, extracted.sourceFps);
      const playbackFps = resolvePlaybackFps(opts.playbackFps, extractFps);
      await repo.updateProjectFps(created.id, playbackFps);
      if (created.timelineId) await repo.updateTimelineFps(created.timelineId, playbackFps);
      const total = extracted.files.length;
      await progress(8, { label: "正在寫入時間軸…", current: 0, total });
      const ingested = await ingestJpegFiles(ctx, {
        projectId: created.id,
        fps: playbackFps,
        extractFps,
        files: extracted.files,
        onProgress: async (done, tot) => {
          await progress(8 + Math.round((done / Math.max(1, tot)) * 90), {
            label: "正在寫入時間軸…",
            current: done,
            total: tot,
          });
        },
      });
      if (!opts.existingVideoId) {
        await repo.insertVideo({
          id: videoId,
          project_id: created.id,
          filename: opts.filename,
          mime_type: opts.mimeType,
          duration_ms: extracted.durationMs,
          frame_count: ingested.frameCount,
          source_path: sourcePath,
          status: "extracted",
          source_fps: extracted.sourceFps,
        });
      }
      await removeDir(outDir).catch(() => undefined);
      return {
        ...ingested,
        sourceFps: extracted.sourceFps,
        extractFps,
        playbackFps,
      };
    },
    summarize: (r) => ({
      ok: true,
      frameCount: r.frameCount,
      projectId: r.projectId,
      timelineId: r.timelineId,
      sourceFps: r.sourceFps,
      extractFps: r.extractFps,
      playbackFps: r.playbackFps,
    }),
  });
  return {
    projectId: created.id,
    timelineId: created.timelineId,
    videoId,
    jobId: handle.jobId,
    done: handle.done,
  };
}

export async function extractAndIngestUploadedVideo(
  ctx: CommandContext,
  opts: {
    filename: string;
    mimeType: string;
    bytes: Buffer | null;
    fps: number;
    playbackFps?: number | string;
    name: string;
    existingVideoId?: string;
    sourcePath?: string;
  },
) {
  const started = await startUploadedVideoIngest(ctx, opts);
  const wrapped = await started.done;
  return {
    projectId: started.projectId,
    timelineId: started.timelineId,
    videoId: started.videoId,
    jobId: started.jobId,
    frames: wrapped.result.frameCount,
    frameCount: wrapped.result.frameCount,
  };
}

void parseScopes;
void getPose;
void analyzeMotion;
