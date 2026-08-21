/** MCP context + lightweight analyze tools. Session-isolated. No SQL in the conversation layer. */

import { fail } from "@/lib/domain/errors";
import {
  hydrateContext,
  pixelsFromNormalized,
  serializeContext,
  type FrameLabContext,
  type RegionSelection,
  type SerializedContext,
} from "@/lib/domain/context-engine";
import { decodeJpegBase64 } from "@/lib/domain/image-codec";
import {
  comparePair,
  cropRgba,
  LIGHTWEIGHT_KIND,
  summarizeObservations,
  type Observation,
} from "@/lib/domain/lightweight-analysis";
import type { RgbaFrame } from "@/lib/domain/pixel-metrics";
import * as repo from "@/lib/framelab/repo";
import type { CommandContext } from "./execute";

function sessionIdOf(args: Record<string, unknown>): string {
  const v = args.sessionId ?? args.session_id ?? args.context_id;
  if (typeof v !== "string" || !v) fail("VALIDATION_ERROR", "sessionId required");
  return v;
}

async function loadOwnedSession(ctx: CommandContext, args: Record<string, unknown>) {
  const sessionId = sessionIdOf(args);
  const session = await repo.getWorkspaceSession(ctx.userId, sessionId);
  if (!session) fail("FRAME_NOT_FOUND", "Workspace session not found", 404);
  const project = await repo.getProject(ctx.userId, session.project_id);
  if (!project) fail("PROJECT_NOT_FOUND", "Project not found", 404);
  const { assertProjectScope } = await import("@/lib/domain/permissions");
  assertProjectScope(ctx.projectScope, project.id);
  return session;
}

function parseSnap(raw: string | null | undefined): SerializedContext | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SerializedContext;
  } catch {
    return null;
  }
}

export function contextFromSession(session: repo.WorkspaceSessionRow): FrameLabContext {
  const parsed = parseSnap(session.context_json);
  if (parsed) {
    return hydrateContext({
      ...parsed,
      session_id: session.id,
      context_version: session.context_version,
    });
  }
  let range: [number, number] | null = null;
  try {
    range = session.selected_range_json
      ? (JSON.parse(session.selected_range_json) as [number, number] | null)
      : null;
  } catch {
    range = null;
  }
  let frames: number[] = [];
  try {
    frames = JSON.parse(session.selected_frames_json || "[]") as number[];
  } catch {
    frames = [];
  }
  let region: RegionSelection | null = null;
  try {
    region = session.selected_region_json
      ? (JSON.parse(session.selected_region_json) as RegionSelection)
      : null;
  } catch {
    region = null;
  }
  return hydrateContext({
    project_id: session.project_id,
    video_id: session.video_id,
    timeline_id: session.timeline_id,
    current_frame: session.current_frame,
    current_frame_id: session.current_frame_id,
    timestamp_ms: null,
    selected_range: range,
    selected_frames: frames,
    selected_character: session.selected_character_id,
    selected_object: session.selected_object_id,
    selected_region: region,
    onion_skin: JSON.parse(session.onion_skin_json || "{}"),
    overlay: JSON.parse(session.overlay_json || "{}"),
    neighbors_available: session.current_frame != null,
    analysis_available: ["lightweight visual analysis"],
    conversation_id: session.conversation_id,
    session_id: session.id,
    context_version: session.context_version,
    viewport: { zoom: 1 },
    focus: "current_frame",
  });
}

function publicFrameMeta(row: repo.FrameRow) {
  return {
    id: row.id,
    frameNumber: row.frame_number,
    timestampMs: row.timestamp_ms,
    durationMs: row.duration_ms,
    frameType: row.frame_type,
    width: row.width,
    height: row.height,
    isLocked: row.is_locked,
    notes: row.notes,
    contentHash: row.content_hash,
    thumbnailRef: row.thumbnail_data ? `frame:${row.id}:thumb` : null,
  };
}

async function availableAnalysis(timelineId: string | null): Promise<string[]> {
  const out = ["lightweight visual analysis"];
  if (!timelineId) return out;
  const cons = await repo.listConsistency(timelineId);
  if (cons.length) out.push("consistency");
  const motion = await repo.listMotion(timelineId);
  if (motion.length) out.push("block-match motion");
  return out;
}

export async function getCurrentContext(ctx: CommandContext, args: Record<string, unknown>) {
  const session = await loadOwnedSession(ctx, args);
  const fl = contextFromSession(session);
  const analysis = await availableAnalysis(session.timeline_id);
  fl.analysisResults = analysis;
  const snap = serializeContext(fl);
  let current: ReturnType<typeof publicFrameMeta> | null = null;
  if (session.timeline_id && session.current_frame != null) {
    const frame = session.current_frame_id
      ? await repo.getFrame(session.current_frame_id)
      : await repo.getFrameByNumber(session.timeline_id, session.current_frame);
    if (frame) current = publicFrameMeta(frame);
  }
  return {
    project_id: session.project_id,
    video_id: session.video_id,
    timeline_id: session.timeline_id,
    current_frame: current,
    selected_range: snap.selected_range
      ? { start: snap.selected_range[0], end: snap.selected_range[1] }
      : null,
    selected_frames: snap.selected_frames,
    selected_region: snap.selected_region,
    selected_character: snap.selected_character,
    selected_object: snap.selected_object,
    onion_skin: snap.onion_skin,
    overlay: snap.overlay,
    analysis_available: analysis,
    available_analysis: analysis,
    conversation_id: snap.conversation_id ?? session.conversation_id,
    context_version: session.context_version,
    session_id: session.id,
    focus: snap.focus,
    viewport: snap.viewport,
    neighbors_available: snap.neighbors_available,
    context: snap,
    project: { id: session.project_id },
    timeline: session.timeline_id ? { id: session.timeline_id } : null,
  };
}

export async function getCurrentFrame(ctx: CommandContext, args: Record<string, unknown>) {
  const session = await loadOwnedSession(ctx, args);
  if (!session.timeline_id || session.current_frame == null) {
    return { frame: null };
  }
  const frame = session.current_frame_id
    ? await repo.getFrame(session.current_frame_id)
    : await repo.getFrameByNumber(session.timeline_id, session.current_frame);
  if (!frame) fail("FRAME_NOT_FOUND", "Selected frame no longer exists", 404);
  return { frame: publicFrameMeta(frame) };
}

export async function getSelectedFrames(ctx: CommandContext, args: Record<string, unknown>) {
  const session = await loadOwnedSession(ctx, args);
  const fl = contextFromSession(session);
  return { frames: fl.selectedFrames, current: fl.currentFrame?.frameNumber ?? null };
}

export async function getSelectedFrameRange(ctx: CommandContext, args: Record<string, unknown>) {
  const session = await loadOwnedSession(ctx, args);
  const fl = contextFromSession(session);
  return {
    range: fl.selectedRange
      ? { start: fl.selectedRange.startFrame, end: fl.selectedRange.endFrame }
      : fl.currentFrame
        ? { start: fl.currentFrame.frameNumber, end: fl.currentFrame.frameNumber }
        : null,
  };
}

export async function getSelectedRegion(ctx: CommandContext, args: Record<string, unknown>) {
  const session = await loadOwnedSession(ctx, args);
  const fl = contextFromSession(session);
  const region = fl.selectedRegion;
  if (!region) return { region: null };
  return {
    region: {
      frame: { id: region.frameId, frameNumber: region.frameNumber },
      coordinates: {
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
      },
      selection_type: region.selectionType,
      preview_asset: `region:${region.frameId}:crop`,
      character_id: fl.selectedCharacterId,
      object_id: fl.selectedObjectId,
    },
  };
}

export async function getCurrentCharacter(ctx: CommandContext, args: Record<string, unknown>) {
  const session = await loadOwnedSession(ctx, args);
  if (!session.selected_character_id) return { character: null };
  const c = await repo.getCharacter(session.selected_character_id);
  if (!c) return { character: null };
  if (c.project_id !== session.project_id) fail("PERMISSION_DENIED", "Character is outside this project", 403);
  return { character: { id: c.id, name: c.name, notes: c.notes } };
}

export async function getCurrentObject(ctx: CommandContext, args: Record<string, unknown>) {
  const session = await loadOwnedSession(ctx, args);
  if (!session.selected_object_id) return { object: null };
  const o = await repo.getObject(session.selected_object_id);
  if (!o) return { object: null };
  if (o.project_id !== session.project_id) fail("PERMISSION_DENIED", "Object is outside this project", 403);
  return { object: { id: o.id, name: o.name, notes: o.notes } };
}

export async function getFrameNeighborsForSession(ctx: CommandContext, args: Record<string, unknown>) {
  const session = await loadOwnedSession(ctx, args);
  if (!session.timeline_id || session.current_frame == null) {
    return { frames: [] as ReturnType<typeof neighborMeta>[] };
  }
  const fl = contextFromSession(session);
  const frames = await repo.listFramesMeta(session.timeline_id);
  const current = session.current_frame;
  const before =
    typeof args.before === "number"
      ? args.before
      : fl.onionSkin.enabled
        ? fl.onionSkin.previousFrames
        : 2;
  const after =
    typeof args.after === "number"
      ? args.after
      : fl.onionSkin.enabled
        ? fl.onionSkin.nextFrames
        : 2;
  return {
    frames: frames
      .filter((f) => f.frame_number >= current - before && f.frame_number <= current + after)
      .map(neighborMeta),
  };
}

function neighborMeta(row: repo.FrameRow) {
  return {
    id: row.id,
    frameNumber: row.frame_number,
    frameType: row.frame_type,
    timestampMs: row.timestamp_ms,
    width: row.width,
    height: row.height,
    thumbnailRef: `frame:${row.id}:thumb`,
  };
}

function selectionFrames(fl: FrameLabContext): number[] {
  if (fl.selectedRange) {
    const out: number[] = [];
    const a = fl.selectedRange.startFrame;
    const b = fl.selectedRange.endFrame;
    const span = Math.min(8, b - a + 1);
    const mid = fl.currentFrame?.frameNumber ?? a;
    const start = Math.max(a, Math.min(mid - 2, b - span + 1));
    for (let i = 0; i < span; i += 1) out.push(start + i);
    return out.filter((n) => n >= a && n <= b);
  }
  const current = fl.currentFrame?.frameNumber;
  if (current == null) return [];
  const before = fl.onionSkin.enabled ? fl.onionSkin.previousFrames : 2;
  const after = fl.onionSkin.enabled ? fl.onionSkin.nextFrames : 2;
  const out: number[] = [];
  for (let n = current - before; n <= current + after; n += 1) out.push(n);
  return out;
}

async function loadRgba(
  timelineId: string,
  frameNumber: number,
  region: RegionSelection | null,
): Promise<{ number: number; rgba: RgbaFrame } | null> {
  const frame = await repo.getFrameByNumber(timelineId, frameNumber);
  if (!frame?.image_data && !frame?.thumbnail_data) return null;
  const rgba = decodeJpegBase64(frame.image_data || frame.thumbnail_data);
  if (!region) return { number: frame.frame_number, rgba };
  const box = pixelsFromNormalized(region, frame.width || rgba.width, frame.height || rgba.height);
  return { number: frame.frame_number, rgba: cropRgba(rgba, box) };
}

export async function analyzeSelection(ctx: CommandContext, args: Record<string, unknown>) {
  const session = await loadOwnedSession(ctx, args);
  const fl = contextFromSession(session);
  if (!session.timeline_id) {
    return {
      kind: LIGHTWEIGHT_KIND,
      summary: "No timeline in this workspace session.",
      frames: [],
      observations: [],
      available_metrics: {},
      limitations: ["Workspace session has no timeline."],
    };
  }
  const types = Array.isArray(args.analysis_types)
    ? (args.analysis_types as string[])
    : ["visual", "motion"];
  const wanted = new Set(types.map((t) => String(t).toLowerCase()));
  const numbers = selectionFrames(fl).filter((n) => n >= 0);
  const unique = [...new Set(numbers)].sort((a, b) => a - b).slice(0, 8);
  const loaded: { number: number; rgba: RgbaFrame }[] = [];
  for (const n of unique) {
    const item = await loadRgba(session.timeline_id, n, fl.selectedRegion);
    if (item) loaded.push(item);
  }
  const observations: Observation[] = [];
  for (let i = 1; i < loaded.length; i += 1) {
    const pair = comparePair(
      loaded[i - 1].rgba,
      loaded[i].rgba,
      loaded[i - 1].number,
      loaded[i].number,
    );
    observations.push(
      ...pair.filter((o) => {
        if (o.kind === "motion_block" || o.kind === "centroid") return wanted.has("motion") || wanted.has("visual");
        return wanted.has("visual") || wanted.size === 0;
      }),
    );
  }
  return summarizeObservations(
    observations,
    loaded.map((l) => l.number),
    Boolean(fl.selectedRegion),
  );
}

export async function analyzeMotionContext(ctx: CommandContext, args: Record<string, unknown>) {
  const session = args.sessionId || args.session_id ? await loadOwnedSession(ctx, args) : null;
  let timelineId =
    typeof args.timelineId === "string" ? args.timelineId : session?.timeline_id ?? null;
  if (!timelineId) fail("VALIDATION_ERROR", "timelineId or sessionId required");
  const t = await repo.getTimeline(timelineId);
  if (!t) fail("FRAME_NOT_FOUND", "Timeline not found", 404);
  const project = await repo.getProject(ctx.userId, t.project_id);
  if (!project) fail("PROJECT_NOT_FOUND", "Project not found", 404);
  const fl = session
    ? contextFromSession(session)
    : hydrateContext({
        project_id: t.project_id,
        video_id: null,
        timeline_id: t.id,
        current_frame: typeof args.startFrame === "number" ? args.startFrame : 0,
        current_frame_id: null,
        timestamp_ms: null,
        selected_range:
          typeof args.startFrame === "number" && typeof args.endFrame === "number"
            ? [args.startFrame, args.endFrame]
            : null,
        selected_frames: [],
        selected_character: null,
        selected_object: null,
        selected_region: null,
        onion_skin: {
          enabled: true,
          previousFrames: 2,
          nextFrames: 2,
          previousOpacity: 0.35,
          nextOpacity: 0.28,
        },
        overlay: {
          pose: false,
          mask: false,
          tracking: false,
          motion: true,
          depth: false,
          consistency: false,
        },
        neighbors_available: true,
        analysis_available: [LIGHTWEIGHT_KIND],
        conversation_id: null,
        session_id: null,
        context_version: 0,
        viewport: { zoom: 1 },
        focus: "selected_frame_range",
      });
  if (typeof args.startFrame === "number" && typeof args.endFrame === "number") {
    fl.selectedRange = { startFrame: args.startFrame, endFrame: args.endFrame };
  }
  const numbers = selectionFrames(fl).filter((n) => n >= 0);
  const unique = [...new Set(numbers)].sort((a, b) => a - b).slice(0, 8);
  const loaded: { number: number; rgba: RgbaFrame }[] = [];
  for (const n of unique) {
    const item = await loadRgba(t.id, n, fl.selectedRegion);
    if (item) loaded.push(item);
  }
  const observations: Observation[] = [];
  for (let i = 1; i < loaded.length; i += 1) {
    observations.push(
      ...comparePair(
        loaded[i - 1].rgba,
        loaded[i].rgba,
        loaded[i - 1].number,
        loaded[i].number,
      ).filter((o) => o.kind === "motion_block" || o.kind === "centroid" || o.kind === "mae"),
    );
  }
  const report = summarizeObservations(
    observations,
    loaded.map((l) => l.number),
    Boolean(fl.selectedRegion),
  );
  return {
    ...report,
    kind: LIGHTWEIGHT_KIND,
    note: "lightweight visual analysis — 16×16 block match + luma centroid. Not SEA-RAFT, not pose.",
  };
}

export async function readSessionContextResource(ctx: CommandContext, sessionId: string) {
  return getCurrentContext(ctx, { sessionId });
}

export async function readConversationResource(ctx: CommandContext, conversationId: string) {
  const conv = await repo.getConversation(ctx.userId, conversationId);
  if (!conv) fail("FRAME_NOT_FOUND", "Conversation not found", 404);
  const messages = await repo.listMessages(conversationId);
  return {
    id: conv.id,
    projectId: conv.project_id,
    timelineId: conv.timeline_id,
    title: conv.title,
    provider: conv.provider,
    mode: conv.mode,
    contextLocked: conv.context_locked,
    frameStart: conv.frame_start,
    frameEnd: conv.frame_end,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      contextVersion: m.context_version,
      contextSnapshot: parseSnap(m.context_snapshot_json),
      createdAt: m.created_at,
    })),
  };
}
