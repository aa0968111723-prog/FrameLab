/** Timeline frame ops: add / insert / duplicate / delete / clear / hold / breakdown. Each writes a revision. */

import { fail } from "@/lib/domain/errors";
import { frameDurationMs } from "@/lib/domain/fps";
import { nid } from "@/lib/domain/ids";
import { blankJpegBase64, hashBytes } from "@/lib/domain/image-codec";
import {
  isBreakdownMode,
  isBreakdownSetType,
  resolveBreakdownTarget,
  resolveCopySource,
  type BreakdownMode,
} from "@/lib/domain/breakdown";
import {
  isTimelineEdit,
  type FrameSnap,
  type TimelineEdit,
  type TimelineOp,
} from "@/lib/domain/timeline-ops";
import * as repo from "@/lib/framelab/repo";
import { ownTimeline } from "./ownership.ts";
import type { CommandContext } from "./execute.ts";

export { isTimelineEdit, type TimelineEdit, type TimelineOp };


function snapFrom(row: repo.FrameRow): FrameSnap {
  return {
    id: row.id,
    timelineId: row.timeline_id,
    frameNumber: row.frame_number,
    timestampMs: row.timestamp_ms,
    durationMs: row.duration_ms,
    frameType: row.frame_type,
    width: row.width,
    height: row.height,
    contentHash: row.content_hash,
    notes: row.notes,
    isLocked: row.is_locked,
    exposureCount: row.exposure_count ?? 1,
    fullAsset: row.full_asset ?? "",
    previewAsset: row.preview_asset ?? "",
    thumbnailAsset: row.thumbnail_asset ?? "",
    originalAsset: row.original_asset ?? "",
    activeAsset: row.active_asset ?? "",
  };
}

async function recount(timelineId: string) {
  const count = (await repo.listFramesMeta(timelineId)).length;
  await repo.setTimelineFrameCount(timelineId, count);
  return count;
}

async function record(
  ctx: CommandContext,
  op: TimelineOp,
  projectId: string,
  frameId: string | null,
  edit: TimelineEdit,
) {
  return repo.insertRevision({
    projectId,
    frameId,
    action: op,
    source: ctx.source,
    caller: ctx.caller,
    previous: edit,
    next: edit,
    timelineId: edit.timelineId,
    startFrame: edit.created?.frameNumber ?? edit.removed?.frameNumber ?? edit.before?.frameNumber ?? null,
    endFrame: edit.created?.frameNumber ?? edit.removed?.frameNumber ?? edit.after?.frameNumber ?? null,
  });
}

async function insertSnap(timelineId: string, snap: FrameSnap) {
  const existing = await repo.getFrame(snap.id);
  if (existing) return;
  await repo.shiftFramesAfter(timelineId, snap.frameNumber, 1);
  await repo.insertFrame({
    id: snap.id,
    timeline_id: timelineId,
    frame_number: snap.frameNumber,
    timestamp_ms: snap.timestampMs,
    duration_ms: snap.durationMs,
    frame_type: snap.frameType,
    image_data: "",
    thumbnail_data: "",
    width: snap.width,
    height: snap.height,
    content_hash: snap.contentHash,
    notes: snap.notes,
    is_locked: snap.isLocked,
  });
  await repo.updateFrame(snap.id, {
    frame_type: snap.frameType,
    duration_ms: snap.durationMs,
    notes: snap.notes,
    is_locked: snap.isLocked,
    content_hash: snap.contentHash,
    width: snap.width,
    height: snap.height,
    exposure_count: snap.exposureCount,
    original_asset: snap.originalAsset,
    active_asset: snap.activeAsset,
    full_asset: snap.fullAsset,
    preview_asset: snap.previewAsset,
    thumbnail_asset: snap.thumbnailAsset,
  });
  if (snap.frameType === "KEY" || snap.frameType === "BREAKDOWN") {
    await repo.upsertKeyframe({
      timelineId,
      frameId: snap.id,
      kind: snap.frameType,
      locked: snap.isLocked,
    });
  }
}

async function removeSnap(timelineId: string, snap: FrameSnap) {
  const existing = await repo.getFrame(snap.id);
  if (!existing) return;
  await repo.deleteFrameRow(snap.id);
  await repo.shiftFramesAfter(timelineId, snap.frameNumber + 1, -1);
}

async function paintSnap(snap: FrameSnap) {
  await repo.updateFrame(snap.id, {
    frame_type: snap.frameType,
    duration_ms: snap.durationMs,
    notes: snap.notes,
    is_locked: snap.isLocked,
    content_hash: snap.contentHash,
    width: snap.width,
    height: snap.height,
    exposure_count: snap.exposureCount,
    original_asset: snap.originalAsset,
    active_asset: snap.activeAsset,
    full_asset: snap.fullAsset,
    preview_asset: snap.previewAsset,
    thumbnail_asset: snap.thumbnailAsset,
  });
  if (snap.frameType === "KEY" || snap.frameType === "BREAKDOWN") {
    await repo.upsertKeyframe({
      timelineId: snap.timelineId,
      frameId: snap.id,
      kind: snap.frameType,
      locked: snap.isLocked,
    });
  } else {
    await repo.deleteKeyframeForFrame(snap.id);
  }
}

export async function applyTimelineEdit(
  ctx: CommandContext,
  edit: TimelineEdit,
  direction: "undo" | "redo",
) {
  const t = await ownTimeline(ctx, edit.timelineId);
  if (edit.op === "add_frame" || edit.op === "insert_frame" || edit.op === "duplicate_frame") {
    if (direction === "undo") {
      if (edit.created) await removeSnap(t.id, edit.created);
    } else if (edit.created) {
      await insertSnap(t.id, edit.created);
    }
  } else if (edit.op === "delete_frame") {
    if (direction === "undo") {
      if (edit.removed) await insertSnap(t.id, edit.removed);
    } else if (edit.removed) {
      await removeSnap(t.id, edit.removed);
    }
  } else if (edit.op === "clear_frame" || edit.op === "hold_frame") {
    const snap = direction === "undo" ? edit.before : edit.after;
    if (snap) await paintSnap(snap);
  } else if (edit.op === "create_breakdown") {
    if (edit.created) {
      if (direction === "undo") await removeSnap(t.id, edit.created);
      else await insertSnap(t.id, edit.created);
    } else {
      const snap = direction === "undo" ? edit.before : edit.after;
      if (snap) await paintSnap(snap);
    }
  }
  await recount(t.id);
  return { op: edit.op, direction };
}

async function putBlank(t: repo.TimelineRow, at: number, template?: repo.FrameRow | null) {
  const width = template?.width || 320;
  const height = template?.height || 180;
  const duration = template?.duration_ms || frameDurationMs(t.fps, 1);
  const jpeg = blankJpegBase64(width, height);
  const id = nid("frm");
  await repo.shiftFramesAfter(t.id, at, 1);
  await repo.insertFrame({
    id,
    timeline_id: t.id,
    frame_number: at,
    timestamp_ms: at * duration,
    duration_ms: duration,
    frame_type: "INBETWEEN",
    image_data: jpeg,
    thumbnail_data: "",
    width,
    height,
    content_hash: hashBytes(jpeg),
    notes: "",
    is_locked: false,
  });
  const created = await repo.getFrameMeta(id);
  if (!created) fail("STORAGE_ERROR", "Frame insert failed");
  return created;
}

export async function addFrameCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const t = await ownTimeline(ctx, String(args.timelineId ?? ""));
  const frames = await repo.listFramesMeta(t.id);
  const current = typeof args.frameNumber === "number" ? args.frameNumber : (frames.at(-1)?.frame_number ?? -1);
  const at = current + 1;
  const template = frames.find((f) => f.frame_number === current) ?? frames.at(-1) ?? null;
  const created = await putBlank(t, at, template);
  await recount(t.id);
  const edit: TimelineEdit = { op: "add_frame", timelineId: t.id, created: snapFrom(created) };
  const revisionId = await record(ctx, "add_frame", t.project_id, created.id, edit);
  return { id: created.id, frameNumber: created.frame_number, revisionId };
}

export async function insertFrameCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const t = await ownTimeline(ctx, String(args.timelineId ?? ""));
  const frames = await repo.listFramesMeta(t.id);
  const at = typeof args.frameNumber === "number" ? args.frameNumber : (frames[0]?.frame_number ?? 0);
  const template = frames.find((f) => f.frame_number === at) ?? frames[0] ?? null;
  const created = await putBlank(t, at, template);
  await recount(t.id);
  const edit: TimelineEdit = { op: "insert_frame", timelineId: t.id, created: snapFrom(created) };
  const revisionId = await record(ctx, "insert_frame", t.project_id, created.id, edit);
  return { id: created.id, frameNumber: created.frame_number, revisionId };
}

export async function duplicateFrameCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const src = await repo.getFrame(String(args.frameId ?? ""));
  if (!src) fail("FRAME_NOT_FOUND", "Frame not found", 404);
  const t = await ownTimeline(ctx, src.timeline_id);
  const id = nid("frm");
  const at = src.frame_number + 1;
  await repo.shiftFramesAfter(t.id, at, 1);
  await repo.insertFrame({
    id,
    timeline_id: t.id,
    frame_number: at,
    timestamp_ms: src.timestamp_ms + src.duration_ms,
    duration_ms: src.duration_ms,
    frame_type: "HOLD",
    image_data: src.image_data,
    thumbnail_data: src.thumbnail_data,
    width: src.width,
    height: src.height,
    content_hash: src.content_hash,
    notes: src.notes,
    is_locked: false,
  });
  const created = await repo.getFrameMeta(id);
  if (!created) fail("STORAGE_ERROR", "Duplicate failed");
  await recount(t.id);
  const edit: TimelineEdit = { op: "duplicate_frame", timelineId: t.id, created: snapFrom(created) };
  const revisionId = await record(ctx, "duplicate_frame", t.project_id, created.id, edit);
  return { id: created.id, frameNumber: created.frame_number, revisionId };
}

export async function deleteFrameCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const frame = await repo.getFrameMeta(String(args.frameId ?? ""));
  if (!frame) fail("FRAME_NOT_FOUND", "Frame not found", 404);
  const t = await ownTimeline(ctx, frame.timeline_id);
  if (frame.is_locked) fail("VALIDATION_ERROR", "Frame is locked");
  const count = (await repo.listFramesMeta(t.id)).length;
  if (count <= 1) fail("VALIDATION_ERROR", "至少要留一格");
  const removed = snapFrom(frame);
  const edit: TimelineEdit = { op: "delete_frame", timelineId: t.id, removed };
  const revisionId = await record(ctx, "delete_frame", t.project_id, frame.id, edit);
  await repo.deleteFrameRow(frame.id);
  await repo.shiftFramesAfter(t.id, frame.frame_number + 1, -1);
  await recount(t.id);
  return { id: frame.id, frameNumber: frame.frame_number, revisionId };
}

export async function clearFrameCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const frame = await repo.getFrameMeta(String(args.frameId ?? ""));
  if (!frame) fail("FRAME_NOT_FOUND", "Frame not found", 404);
  const t = await ownTimeline(ctx, frame.timeline_id);
  if (frame.is_locked) fail("VALIDATION_ERROR", "Frame is locked");
  const before = snapFrom(frame);
  const jpeg = blankJpegBase64(frame.width || 320, frame.height || 180);
  await repo.updateFrame(frame.id, {
    image_data: jpeg,
    thumbnail_data: "",
    content_hash: hashBytes(jpeg),
    width: frame.width || 320,
    height: frame.height || 180,
  });
  const afterRow = await repo.getFrameMeta(frame.id);
  const after = afterRow ? snapFrom(afterRow) : before;
  const edit: TimelineEdit = { op: "clear_frame", timelineId: t.id, before, after };
  const revisionId = await record(ctx, "clear_frame", t.project_id, frame.id, edit);
  return { id: frame.id, revisionId };
}

export async function holdFrameCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const frame = await repo.getFrameMeta(String(args.frameId ?? ""));
  if (!frame) fail("FRAME_NOT_FOUND", "Frame not found", 404);
  const t = await ownTimeline(ctx, frame.timeline_id);
  if (frame.is_locked) fail("VALIDATION_ERROR", "Frame is locked");
  const before = snapFrom(frame);
  const exposure = Math.max(2, Math.min(4, frame.exposure_count ?? 1));
  const duration = frameDurationMs(t.fps, exposure);
  await repo.updateFrame(frame.id, {
    frame_type: "HOLD",
    exposure_count: exposure,
    duration_ms: duration,
  });
  await repo.deleteKeyframeForFrame(frame.id);
  const afterRow = await repo.getFrameMeta(frame.id);
  const after = afterRow ? snapFrom(afterRow) : before;
  const edit: TimelineEdit = { op: "hold_frame", timelineId: t.id, before, after };
  const revisionId = await record(ctx, "hold_frame", t.project_id, frame.id, edit);
  return { id: frame.id, exposureCount: exposure, revisionId };
}

async function applyBreakdownPixels(
  frameId: string,
  mode: BreakdownMode,
  frameType: string,
  source: repo.FrameRow | null,
) {
  if (mode === "blank") {
    const meta = await repo.getFrameMeta(frameId);
    const jpeg = blankJpegBase64(meta?.width || source?.width || 320, meta?.height || source?.height || 180);
    await repo.updateFrame(frameId, {
      image_data: jpeg,
      thumbnail_data: "",
      content_hash: hashBytes(jpeg),
      frame_type: frameType,
      width: meta?.width || source?.width || 320,
      height: meta?.height || source?.height || 180,
    });
  } else if (mode === "copy") {
    if (!source?.image_data) fail("FRAME_ASSET_UNAVAILABLE", "Copy source has no image");
    await repo.updateFrame(frameId, {
      image_data: source.image_data,
      thumbnail_data: source.thumbnail_data || "",
      content_hash: source.content_hash,
      frame_type: frameType,
      width: source.width,
      height: source.height,
    });
  } else {
    await repo.updateFrame(frameId, { frame_type: frameType });
  }
  if (frameType === "KEY" || frameType === "BREAKDOWN") {
    const row = await repo.getFrameMeta(frameId);
    if (row) {
      await repo.upsertKeyframe({
        timelineId: row.timeline_id,
        frameId: row.id,
        kind: frameType,
        locked: row.is_locked,
      });
    }
  } else {
    await repo.deleteKeyframeForFrame(frameId);
  }
}

export async function createBreakdownCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const t = await ownTimeline(ctx, String(args.timelineId ?? ""));
  const start = Number(args.startFrame ?? args.frameA);
  const end = Number(args.endFrame ?? args.frameB);
  const modeRaw = typeof args.mode === "string" ? args.mode : "blank";
  if (!isBreakdownMode(modeRaw)) fail("VALIDATION_ERROR", `Invalid breakdown mode ${modeRaw}`);
  const mode: BreakdownMode = modeRaw;
  const typeRaw = typeof args.frameType === "string" ? args.frameType : "BREAKDOWN";
  if (typeRaw === "GENERATED_BREAKDOWN") {
    fail("VALIDATION_ERROR", "Generative breakdown is not enabled. Use blank or copy.");
  }
  if (!isBreakdownSetType(typeRaw)) {
    fail("VALIDATION_ERROR", `Frame type must be KEY | BREAKDOWN | INBETWEEN | HOLD`);
  }
  const { lo, hi, target, insert } = resolveBreakdownTarget({
    start,
    end,
    requested: typeof args.frameNumber === "number" ? args.frameNumber : Number.NaN,
  });
  const keyA = await repo.getFrameByNumber(t.id, lo);
  const keyB = await repo.getFrameByNumber(t.id, hi);
  if (!keyA || !keyB) fail("KEYFRAME_NOT_FOUND", "Keyframe A/B not found", 404);

  const copyFrom = resolveCopySource(lo, hi, args.copyFrom);
  const source =
    mode === "copy"
      ? copyFrom === hi
        ? keyB
        : copyFrom === lo
          ? keyA
          : ((await repo.getFrameByNumber(t.id, copyFrom)) ?? keyA)
      : keyA;

  if (insert) {
    const createdRow = await putBlank(t, target, keyA);
    await applyBreakdownPixels(createdRow.id, mode === "mark" ? "blank" : mode, typeRaw, source);
    await recount(t.id);
    const created = await repo.getFrameMeta(createdRow.id);
    if (!created) fail("STORAGE_ERROR", "Breakdown insert failed");
    const edit: TimelineEdit = { op: "create_breakdown", timelineId: t.id, created: snapFrom(created) };
    const revisionId = await record(ctx, "create_breakdown", t.project_id, created.id, edit);
    return {
      id: created.id,
      frameNumber: created.frame_number,
      frameType: created.frame_type,
      mode: mode === "mark" ? "blank" : mode,
      inserted: true,
      startFrame: lo,
      endFrame: hi + 1,
      revisionId,
      auto: false,
      generative: false,
    };
  }

  const existing = await repo.getFrameByNumber(t.id, target);
  if (!existing) fail("FRAME_NOT_FOUND", `No frame at F${target}`, 404);
  if (existing.is_locked) fail("VALIDATION_ERROR", "Frame is locked");
  if (existing.frame_type === "KEY" && args.overwriteKey !== true) {
    fail("INVALID_KEYFRAME_PAIR", "Cannot overwrite a KEY. Pick an interior frame.");
  }
  const before = snapFrom(existing);
  await applyBreakdownPixels(existing.id, mode, typeRaw, source);
  const afterRow = await repo.getFrameMeta(existing.id);
  const after = afterRow ? snapFrom(afterRow) : before;
  const edit: TimelineEdit = { op: "create_breakdown", timelineId: t.id, before, after };
  const revisionId = await record(ctx, "create_breakdown", t.project_id, existing.id, edit);
  return {
    id: existing.id,
    frameNumber: existing.frame_number,
    frameType: after.frameType,
    mode,
    inserted: false,
    startFrame: lo,
    endFrame: hi,
    revisionId,
    auto: false,
    generative: false,
  };
}

