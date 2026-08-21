import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { probeRtmpose, runRtmposeBatch, rtmposeWorkerPath } from "../src/lib/ai/rtmpose-worker.ts";

const fixture = path.join(process.cwd(), "workers/gpu-worker/fixtures/person.jpg");

describe("RTMPose worker", () => {
  it("health is ready", () => {
    const h = probeRtmpose();
    assert.equal(h.ok, true, h.error);
    assert.equal(h.provider, "rtmpose");
    assert.ok(h.device === "cpu" || h.device === "cuda");
  });

  it("detects a person and returns COCO-17 keypoints", async () => {
    assert.equal(fs.existsSync(fixture), true);
    const { poses, model } = await runRtmposeBatch([
      { id: "person", path: fixture, frameNumber: 0, width: 640, height: 425 },
    ]);
    assert.equal(model, "rtmpose-s");
    assert.equal(poses.length, 1);
    const p = poses[0]!;
    assert.ok(p.people >= 1);
    const names = new Set(p.keypoints.map((k) => k.name));
    assert.ok(names.has("nose"));
    assert.ok(names.has("left_wrist"));
    assert.ok(names.has("right_ankle"));
    const nose = p.keypoints.find((k) => k.name === "nose")!;
    assert.ok(nose.confidence > 0.5);
    assert.ok(nose.x > 0 && nose.x < 1);
    assert.ok(nose.y > 0 && nose.y < 1);
  });

  it("wires UI → job → worker → DB → canvas", () => {
    const worker = fs.readFileSync(rtmposeWorkerPath(), "utf8");
    const assist = fs.readFileSync(path.join(process.cwd(), "src/lib/commands/assist-tools.ts"), "utf8");
    const providers = fs.readFileSync(path.join(process.cwd(), "src/lib/ai/providers.ts"), "utf8");
    const studio = fs.readFileSync(path.join(process.cwd(), "src/components/workstation/studio-app.tsx"), "utf8");
    const canvas = fs.readFileSync(path.join(process.cwd(), "src/components/workstation/animation-canvas.tsx"), "utf8");
    assert.match(worker, /from rtmlib import Body/);
    assert.match(worker, /RTMPose/);
    assert.match(assist, /runRtmposeBatch/);
    assert.match(assist, /POSE_ANALYSIS/);
    assert.match(assist, /replacePosesForFrames/);
    assert.match(assist, /provider: "rtmpose"/);
    assert.match(providers, /class RtmposeProvider/);
    assert.doesNotMatch(providers, /new Reserved\("rtmpose"\)/);
    assert.match(studio, /provider: "rtmpose"/);
    assert.match(studio, /primary: "pose"/);
    assert.match(canvas, /drawPoseSkeleton/);
    assert.match(assist, /framelab-pose-lite/);
  });
});
