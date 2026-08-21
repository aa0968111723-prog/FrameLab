import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { locotrackWorkerPath, probeLocotrack, runLocotrack } from "../src/lib/ai/locotrack-worker.ts";

describe("LocoTrack worker", () => {
  it("health is ready", () => {
    const h = probeLocotrack();
    assert.equal(h.ok, true, h.error);
    assert.equal(h.provider, "locotrack");
  });

  it("tracks a moving blob across frames with visible status", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lt-"));
    const py = `
import cv2, numpy as np, json, sys
out=sys.argv[1]
frames=[]
for t in range(8):
    img=np.zeros((120,160,3), np.uint8)
    x=20+t*12; y=40
    img[y:y+16, x:x+16]=(240,240,240)
    p=f"{out}/f{t:02d}.jpg"
    cv2.imwrite(p, img)
    frames.append({"path":p,"frameNumber":t,"width":160,"height":120})
print(json.dumps(frames))
`;
    const r = spawnSync("python3", ["-c", py, dir], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const frames = JSON.parse(r.stdout.trim().split("\n").at(-1) || "[]") as {
      path: string;
      frameNumber: number;
      width: number;
      height: number;
    }[];
    const { tracks, model } = await runLocotrack({
      frames,
      queries: [{ name: "blob", x: 28, y: 48, frameNumber: 0 }],
    });
    assert.equal(model, "locotrack-s");
    assert.equal(tracks.length, 1);
    const samples = tracks[0]!.samples;
    assert.equal(samples.length, 8);
    assert.ok(samples[7]!.x - samples[0]!.x > 20);
    assert.ok(samples.every((s) => ["visible", "occluded", "lost", "recovered"].includes(s.status)));
    assert.equal(samples[0]!.status, "visible");
  });

  it("wires click → job → worker → DB → trail", () => {
    const worker = fs.readFileSync(locotrackWorkerPath(), "utf8");
    const exec = fs.readFileSync(path.join(process.cwd(), "src/lib/commands/execute.ts"), "utf8");
    const providers = fs.readFileSync(path.join(process.cwd(), "src/lib/ai/providers.ts"), "utf8");
    const studio = fs.readFileSync(path.join(process.cwd(), "src/components/workstation/studio-app.tsx"), "utf8");
    const overlay = fs.readFileSync(path.join(process.cwd(), "src/lib/visual/overlay-renderer.ts"), "utf8");
    assert.match(worker, /load_model/);
    assert.match(worker, /locotrack-s/);
    assert.match(exec, /runLocotrack/);
    assert.match(exec, /POINT_TRACKING/);
    assert.match(exec, /provider: args.provider \?\? "locotrack"/);
    assert.match(providers, /class LocotrackProvider/);
    assert.doesNotMatch(providers, /new Reserved\("locotrack"\)/);
    assert.match(studio, /provider: "locotrack"/);
    assert.match(studio, /primary: "track"/);
    assert.match(overlay, /STATUS_COLOR/);
    assert.match(overlay, /recovered/);
  });
});
