/** Edit canvas skeleton joints. Writes PoseConstraint + Revision. Never mutates pixels. */

import { fail } from "@/lib/domain/errors";
import { nid } from "@/lib/domain/ids";
import {
  assertPoseJoints,
  isPoseEdit,
  jointByName,
  movePoseJoint,
  normalizeJoints,
  type PoseConstraintRow,
  type PoseEditSnap,
  type PoseJoint,
} from "@/lib/domain/pose-edit";
import { toNormalized } from "@/lib/domain/visual-annotation";
import * as repo from "@/lib/framelab/repo";
import { ownTimeline } from "./ownership.ts";
import type { CommandContext } from "./execute.ts";

function num(v: unknown, fallback = Number.NaN): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export async function applyPoseEditSnap(snap: PoseEditSnap) {
  await repo.updatePoseJoints(snap.frameId, snap.joints);
  await repo.replacePoseConstraintsForFrame(snap.frameId, snap.constraints);
}

export async function listPoseConstraintsCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const timelineId = String(args.timelineId ?? "");
  if (!timelineId) fail("VALIDATION_ERROR", "timelineId required");
  const t = await ownTimeline(ctx, timelineId);
  const rows = await repo.listPoseConstraints(t.id);
  const frameNumber = num(args.frameNumber);
  const filtered = Number.isFinite(frameNumber)
    ? rows.filter((r) => r.frame_number === frameNumber)
    : rows;
  return {
    constraints: filtered.map(rowToConstraint),
  };
}

function rowToConstraint(row: PoseConstraintRow) {
  let keypoints: PoseJoint[] = [];
  try {
    keypoints = JSON.parse(row.keypoints_json) as PoseJoint[];
  } catch {
    keypoints = [];
  }
  return {
    id: row.id,
    project_id: row.project_id,
    timeline_id: row.timeline_id,
    frame_id: row.frame_id,
    frame_number: row.frame_number,
    joint: row.joint,
    x: row.x,
    y: row.y,
    previous_x: row.previous_x,
    previous_y: row.previous_y,
    keypoints,
    source: row.source,
    kind: row.kind,
    revision_id: row.revision_id,
  };
}

export async function editPoseCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const timelineId = String(args.timelineId ?? "");
  const t = await ownTimeline(ctx, timelineId);
  const frameNumber = num(args.frameNumber);
  const frame =
    typeof args.frameId === "string" && args.frameId
      ? await repo.getFrameMeta(args.frameId)
      : await repo.getFrameByNumber(t.id, frameNumber);
  if (!frame || frame.timeline_id !== t.id) fail("FRAME_NOT_FOUND", "Frame not found", 404);

  const existing = await repo.getPoseForFrame(frame.id);
  if (!existing) fail("FRAME_NOT_FOUND", "No pose on this frame. Run analyze_pose first.", 404);

  let before: PoseJoint[] = [];
  try {
    const parsed = JSON.parse(existing.joints_json) as PoseJoint[];
    before = Array.isArray(parsed) ? parsed : [];
  } catch {
    before = [];
  }
  if (!before.length) fail("FRAME_NOT_FOUND", "No pose on this frame. Run analyze_pose first.", 404);

  const joint = String(args.joint ?? args.name ?? "");
  if (!joint) fail("VALIDATION_ERROR", "joint required");

  const fw = frame.width || 1;
  const fh = frame.height || 1;
  let after: PoseJoint[];
  if (Array.isArray(args.keypoints)) {
    after = normalizeJoints(assertPoseJoints(args.keypoints), fw, fh);
  } else {
    const rawX = num(args.x);
    const rawY = num(args.y);
    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) fail("VALIDATION_ERROR", "x and y required");
    const n = toNormalized(rawX, rawY, fw, fh);
    after = normalizeJoints(movePoseJoint(before, joint, n.x, n.y), fw, fh);
  }

  const prevJoint = jointByName(before, joint);
  const nextJoint = jointByName(after, joint);
  if (!nextJoint) fail("VALIDATION_ERROR", `Joint ${joint} missing after edit`);

  const previousConstraints = await repo.listPoseConstraintsForFrame(frame.id);
  const previous: PoseEditSnap = {
    op: "edit_pose",
    frameId: frame.id,
    frameNumber: frame.frame_number,
    joints: before,
    constraints: previousConstraints,
  };

  await repo.updatePoseJoints(frame.id, after);
  const constraintId = nid("psc");
  const row: PoseConstraintRow = {
    id: constraintId,
    project_id: t.project_id,
    timeline_id: t.id,
    frame_id: frame.id,
    frame_number: frame.frame_number,
    joint,
    x: nextJoint.x,
    y: nextJoint.y,
    previous_x: prevJoint?.x ?? nextJoint.x,
    previous_y: prevJoint?.y ?? nextJoint.y,
    keypoints_json: JSON.stringify(after),
    source: "user",
    kind: "POSE_JOINT",
    revision_id: null,
  };
  await repo.insertPoseConstraint(row);
  const nextConstraints = [...previousConstraints, row];
  const next: PoseEditSnap = {
    op: "edit_pose",
    frameId: frame.id,
    frameNumber: frame.frame_number,
    joints: after,
    constraints: nextConstraints,
  };
  const revisionId = await repo.insertRevision({
    projectId: t.project_id,
    frameId: frame.id,
    action: "edit_pose",
    source: ctx.source,
    caller: ctx.caller,
    previous,
    next,
    timelineId: t.id,
    startFrame: frame.frame_number,
    endFrame: frame.frame_number,
  });
  await repo.setPoseConstraintRevision(constraintId, revisionId);
  row.revision_id = revisionId;
  return {
    id: constraintId,
    revisionId,
    frameId: frame.id,
    frameNumber: frame.frame_number,
    joint,
    x: nextJoint.x,
    y: nextJoint.y,
    constraint: rowToConstraint({ ...row, revision_id: revisionId }),
    keypoints: after,
    pixelsChanged: false,
  };
}

export { isPoseEdit };
