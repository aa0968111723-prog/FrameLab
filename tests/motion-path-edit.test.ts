import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { isMotionEdit, motionPixels } from "../src/lib/domain/motion-path-edit.ts";
import { composeTrail, hitMotionPathPoint, poseTrailSamples } from "../src/lib/visual/overlay-renderer.ts";
import { TOOL_SCOPES } from "../src/lib/domain/permissions.ts";
import { isAskToolAllowed, isAssistToolAllowed } from "../src/lib/domain/conversation.ts";
import { MCP_TOOLS } from "../src/lib/mcp/catalog.ts";
import { mapRestPath } from "../src/lib/framelab/rest-map.ts";

describe("motion path math", () => {
  it("builds a right-hand trail from pose when tracking is empty", () => {
    const poses = [
      {
        frame_number: 104,
        joints_json: JSON.stringify([{ name: "right_wrist", x: 0.2, y: 0.4, confidence: 1 }]),
      },
      {
        frame_number: 105,
        joints_json: JSON.stringify([{ name: "right_wrist", x: 0.3, y: 0.5, confidence: 1 }]),
      },
    ];
    const fromPose = poseTrailSamples(poses, "right_hand");
    assert.equal(fromPose.length, 2);
    const trail = composeTrail([], poses, "right_hand");
    assert.equal(trail.name, "right_wrist");
    assert.equal(trail.samples.length, 2);
  });

  it("lets a tracking sample override one pose frame", () => {
    const poses = [
      { frame_number: 1, joints_json: JSON.stringify([{ name: "right_wrist", x: 0.2, y: 0.2, confidence: 1 }]) },
      { frame_number: 2, joints_json: JSON.stringify([{ name: "right_wrist", x: 0.8, y: 0.8, confidence: 1 }]) },
    ];
    const tracking = [{ name: "right_wrist", x: 0.5, y: 0.1, frame_number: 2, status: "visible", score: 1 }];
    const trail = composeTrail(tracking, poses, "right_hand");
    assert.equal(trail.samples.find((s) => s.frame_number === 1)?.x, 0.2);
    assert.equal(trail.samples.find((s) => s.frame_number === 2)?.x, 0.5);
  });

  it("does not steal an unrelated tracking point when showing 右手", () => {
    const poses = [
      { frame_number: 1, joints_json: JSON.stringify([{ name: "right_wrist", x: 0.4, y: 0.4, confidence: 1 }]) },
    ];
    const tracking = [{ name: "click-F1-10-10", x: 10, y: 10, frame_number: 1, status: "visible", score: 1 }];
    const trail = composeTrail(tracking, poses, "right_hand");
    assert.equal(trail.name, "right_wrist");
    assert.equal(trail.samples[0]?.x, 0.4);
  });

  it("hits a control point and converts normalized coords to pixels", () => {
    const hit = hitMotionPathPoint(
      [
        { x: 10, y: 10, frame: 3 },
        { x: 80, y: 40, frame: 4 },
      ],
      81,
      41,
      8,
    );
    assert.equal(hit?.frame, 4);
    assert.deepEqual(motionPixels(0.5, 0.25, 200, 100), { x: 100, y: 25 });
  });
});

describe("motion path edit contract", () => {
  it("edit_motion_path is EDIT and never touches pixels or keyframes", () => {
    assert.equal(TOOL_SCOPES.edit_motion_path, "EDIT");
    assert.equal(TOOL_SCOPES.list_motion_constraints, "READ");
    assert.equal(isAskToolAllowed("edit_motion_path"), false);
    assert.equal(isAssistToolAllowed("edit_motion_path"), false);
    assert.equal(isAskToolAllowed("list_motion_constraints"), true);
    assert.ok(MCP_TOOLS.some((t) => t.name === "edit_motion_path"));
    assert.equal(mapRestPath("POST", "/api/v1/motion-path/edit", {})?.tool, "edit_motion_path");
    const cmd = readFileSync(new URL("../src/lib/commands/motion-path-tools.ts", import.meta.url), "utf8");
    assert.match(cmd, /export async function editMotionPathCmd/);
    assert.match(cmd, /insertMotionConstraint/);
    assert.match(cmd, /insertRevision/);
    assert.match(cmd, /pixelsChanged: false/);
    assert.match(cmd, /keyframeChanged: false/);
    assert.doesNotMatch(cmd, /updateFrame/);
    assert.doesNotMatch(cmd, /image_data/);
    assert.doesNotMatch(cmd, /upsertKeyframe/);
    assert.doesNotMatch(cmd, /deleteKeyframe/);
    assert.doesNotMatch(cmd, /frame_type/);
    assert.equal(
      isMotionEdit({
        op: "edit_motion_path",
        projectId: "p",
        timelineId: "t",
        frameId: null,
        frameNumber: 1,
        name: "right_wrist",
        pointId: "trk1",
        x: 1,
        y: 1,
        present: true,
        constraints: [],
      }),
      true,
    );
  });

  it("canvas drags a path handle and studio saves a constraint", () => {
    const canvas = readFileSync(new URL("../src/components/workstation/animation-canvas.tsx", import.meta.url), "utf8");
    const studio = readFileSync(new URL("../src/components/workstation/studio-app.tsx", import.meta.url), "utf8");
    assert.match(canvas, /hitMotionPathPoint/);
    assert.match(canvas, /onMotionPathEdit/);
    assert.match(canvas, /pathDrag/);
    assert.match(canvas, /composeTrail/);
    assert.match(studio, /tool: "edit_motion_path"/);
    assert.match(studio, /拖動路徑點可改這一格，不會動關鍵影格/);
  });
});
