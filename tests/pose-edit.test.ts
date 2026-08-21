import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  clamp01,
  isPoseEdit,
  movePoseJoint,
  normalizeJoints,
} from "../src/lib/domain/pose-edit.ts";
import { hitPoseJoint } from "../src/lib/visual/overlay-renderer.ts";
import type { ViewportTransform } from "../src/lib/visual/viewport.ts";
import { TOOL_SCOPES } from "../src/lib/domain/permissions.ts";
import { isAskToolAllowed, isAssistToolAllowed } from "../src/lib/domain/conversation.ts";
import { MCP_TOOLS } from "../src/lib/mcp/catalog.ts";
import { mapRestPath } from "../src/lib/framelab/rest-map.ts";

const joints = [
  { name: "nose", x: 0.5, y: 0.2, confidence: 0.9 },
  { name: "right_wrist", x: 0.7, y: 0.6, confidence: 0.8 },
];

describe("pose joint math", () => {
  it("moves a joint in place and keeps others", () => {
    const next = movePoseJoint(joints, "right_wrist", 0.81, 0.42);
    assert.equal(next.find((j) => j.name === "nose")?.x, 0.5);
    const w = next.find((j) => j.name === "right_wrist")!;
    assert.equal(w.x, 0.81);
    assert.equal(w.y, 0.42);
  });

  it("appends a derived joint that was not stored", () => {
    const next = movePoseJoint(joints, "right_elbow", 0.6, 0.4);
    assert.ok(next.some((j) => j.name === "right_elbow"));
    assert.equal(next.length, 3);
  });

  it("clamps and normalizes", () => {
    assert.equal(clamp01(1.4), 1);
    const n = normalizeJoints([{ name: "nose", x: 80, y: 20, confidence: 1 }], 100, 50);
    assert.equal(n[0]!.x, 0.8);
    assert.equal(n[0]!.y, 0.4);
  });

  it("hits the nearest joint in screen space", () => {
    const vt: ViewportTransform = {
      dx: 0,
      dy: 0,
      scale: 1,
      frameWidth: 100,
      frameHeight: 100,
      viewWidth: 100,
      viewHeight: 100,
      zoom: 1,
    };
    const name = hitPoseJoint(vt, [{ name: "nose", x: 0.5, y: 0.5, confidence: 1 }], 50, 50, 20);
    assert.equal(name, "nose");
    assert.equal(hitPoseJoint(vt, [{ name: "nose", x: 0.5, y: 0.5, confidence: 1 }], 90, 90, 8), null);
  });
});

describe("pose edit contract", () => {
  it("edit_pose is EDIT, not generative, and does not write pixels", () => {
    assert.equal(TOOL_SCOPES.edit_pose, "EDIT");
    assert.equal(TOOL_SCOPES.list_pose_constraints, "READ");
    assert.equal(isAskToolAllowed("edit_pose"), false);
    assert.equal(isAssistToolAllowed("edit_pose"), false);
    assert.equal(isAskToolAllowed("list_pose_constraints"), true);
    assert.ok(MCP_TOOLS.some((t) => t.name === "edit_pose"));
    assert.equal(mapRestPath("POST", "/api/v1/poses/edit", {})?.tool, "edit_pose");
    const cmd = readFileSync(new URL("../src/lib/commands/pose-edit-tools.ts", import.meta.url), "utf8");
    assert.match(cmd, /export async function editPoseCmd/);
    assert.match(cmd, /pixelsChanged: false/);
    assert.match(cmd, /insertPoseConstraint/);
    assert.match(cmd, /insertRevision/);
    assert.doesNotMatch(cmd, /updateFrame/);
    assert.doesNotMatch(cmd, /image_data/);
    assert.doesNotMatch(cmd, /replace_frame/);
    assert.equal(isPoseEdit({ op: "edit_pose", frameId: "f", frameNumber: 1, joints: [], constraints: [] }), true);
    assert.equal(isPoseEdit({ op: "clear_frame" }), false);
  });

  it("canvas drags joints and studio saves a constraint", () => {
    const canvas = readFileSync(new URL("../src/components/workstation/animation-canvas.tsx", import.meta.url), "utf8");
    const studio = readFileSync(new URL("../src/components/workstation/studio-app.tsx", import.meta.url), "utf8");
    assert.match(canvas, /hitPoseJoint/);
    assert.match(canvas, /onPoseEdit/);
    assert.match(canvas, /poseDrag/);
    assert.match(canvas, /movePoseJoint/);
    assert.doesNotMatch(canvas, /onPaintCommit\?\.\(.*pose/);
    assert.match(studio, /tool: "edit_pose"/);
    assert.match(studio, /拖動關節可改骨架，不會改圖/);
    assert.match(studio, /poseConstraints/);
  });
});
