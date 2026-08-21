/** Edit one motion-path control point. Writes MotionConstraint + Revision. Never mutates pixels or keyframes. */

import { fail } from "@/lib/domain/errors";
import { nid } from "@/lib/domain/ids";
import {
  assertTrailName,
  isMotionEdit,
  motionPixels,
  type MotionConstraintRow,
  type MotionEditSnap,
} from "@/lib/domain/motion-path-edit";
import { toNormalized } from "@/lib/domain/visual-annotation";
import * as repo from "@/lib/framelab/repo";
import { ownProject, ownTimeline } from "./ownership.ts";
import type { CommandContext } from "./execute.ts";

function num(v: unknown, fallback = Number.NaN): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export async function applyMotionEditSnap(snap: MotionEditSnap) {
  if (snap.present) {
    await repo.upsertTrackingPoint({
      id: snap.pointId,
      projectId: snap.projectId,
      name: snap.name,
      x: snap.x,
      y: snap.y,
      frameNumber: snap.frameNumber,
    });
  } else {
    await repo.deleteTrackingPoint(snap.pointId);
  }
  await repo.replaceMotionConstraintsForPoint(snap.projectId, snap.name, snap.frameNumber, snap.constraints);
}

function rowToConstraint(row: MotionConstraintRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    timeline_id: row.timeline_id,
    frame_id: row.frame_id,
    frame_number: row.frame_number,
    name: row.name,
    x: row.x,
    y: row.y,
    previous_x: row.previous_x,
    previous_y: row.previous_y,
    source: row.source,
    kind: row.kind,
    revision_id: row.revision_id,
  };
}

export async function listMotionConstraintsCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const projectId = String(args.projectId ?? "");
  if (!projectId) fail("VALIDATION_ERROR", "projectId required");
  await ownProject(ctx, projectId);
  const rows = await repo.listMotionConstraints(projectId);
  const frameNumber = num(args.frameNumber);
  const name = typeof args.name === "string" ? args.name : "";
  const filtered = rows.filter((r) => {
    if (Number.isFinite(frameNumber) && r.frame_number !== frameNumber) return false;
    if (name && r.name !== name) return false;
    return true;
  });
  return { constraints: filtered.map(rowToConstraint) };
}

export async function editMotionPathCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const timelineId = String(args.timelineId ?? "");
  const t = await ownTimeline(ctx, timelineId);
  const name = assertTrailName(String(args.name ?? args.joint ?? ""));
  const frameNumber = num(args.frameNumber);
  if (!Number.isFinite(frameNumber)) fail("VALIDATION_ERROR", "frameNumber required");
  const rawX = num(args.x);
  const rawY = num(args.y);
  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) fail("VALIDATION_ERROR", "x and y required");

  const frame = await repo.getFrameByNumber(t.id, frameNumber);
  const fw = frame?.width || 1;
  const fh = frame?.height || 1;
  const n = toNormalized(rawX, rawY, fw, fh);
  const px = motionPixels(n.x, n.y, fw, fh);

  const existing = await repo.getTrackingPointByNameFrame(t.project_id, name, frameNumber);
  const previousConstraints = await repo.listMotionConstraintsForPoint(t.project_id, name, frameNumber);
  const pointId = existing?.id ?? nid("trk");
  const previous: MotionEditSnap = {
    op: "edit_motion_path",
    projectId: t.project_id,
    timelineId: t.id,
    frameId: frame?.id ?? null,
    frameNumber,
    name,
    pointId,
    x: existing?.x ?? px.x,
    y: existing?.y ?? px.y,
    present: Boolean(existing),
    constraints: previousConstraints,
  };

  await repo.upsertTrackingPoint({
    id: pointId,
    projectId: t.project_id,
    name,
    x: px.x,
    y: px.y,
    frameNumber,
    status: existing?.status ?? "visible",
    score: existing?.score ?? 1,
    trackId: existing?.track_id ?? name,
  });

  const constraintId = nid("msc");
  const row: MotionConstraintRow = {
    id: constraintId,
    project_id: t.project_id,
    timeline_id: t.id,
    frame_id: frame?.id ?? null,
    frame_number: frameNumber,
    name,
    x: n.x,
    y: n.y,
    previous_x: existing
      ? toNormalized(existing.x, existing.y, fw, fh).x
      : n.x,
    previous_y: existing
      ? toNormalized(existing.x, existing.y, fw, fh).y
      : n.y,
    source: "user",
    kind: "MOTION_PATH",
    revision_id: null,
  };
  await repo.insertMotionConstraint(row);
  const next: MotionEditSnap = {
    op: "edit_motion_path",
    projectId: t.project_id,
    timelineId: t.id,
    frameId: frame?.id ?? null,
    frameNumber,
    name,
    pointId,
    x: px.x,
    y: px.y,
    present: true,
    constraints: [...previousConstraints, row],
  };
  const revisionId = await repo.insertRevision({
    projectId: t.project_id,
    frameId: frame?.id ?? null,
    action: "edit_motion_path",
    source: ctx.source,
    caller: ctx.caller,
    previous,
    next,
    timelineId: t.id,
    startFrame: frameNumber,
    endFrame: frameNumber,
  });
  await repo.setMotionConstraintRevision(constraintId, revisionId);
  row.revision_id = revisionId;
  return {
    id: constraintId,
    revisionId,
    frameId: frame?.id ?? null,
    frameNumber,
    name,
    x: n.x,
    y: n.y,
    constraint: rowToConstraint(row),
    pixelsChanged: false,
    keyframeChanged: false,
  };
}

export { isMotionEdit };
