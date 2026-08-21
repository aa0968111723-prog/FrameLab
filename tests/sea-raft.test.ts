import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { probeSeaRaft, runSeaRaft, seaRaftWorkerPath } from "../src/lib/ai/sea-raft-worker.ts";

describe("SEA-RAFT worker", () => {
  it("health is ready", () => {
    const h = probeSeaRaft();
    assert.equal(h.ok, true, h.error);
    assert.equal(h.provider, "sea-raft");
  });

  it("runs real two-frame inference with rightward flow", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sr-"));
    const py = `
import cv2, numpy as np, json, sys
out=sys.argv[1]
rng=np.random.RandomState(0)
H,W=256,384
tex=rng.randint(40,220,(H,W,3),np.uint8)
a=tex.copy(); b=tex.copy()
cv2.circle(a,(90,110),28,(20,180,240),-1)
cv2.circle(b,(90+18,110),28,(20,180,240),-1)
cv2.imwrite(f"{out}/a.jpg", a)
cv2.imwrite(f"{out}/b.jpg", b)
print(json.dumps({"w":W,"h":H}))
`;
    const r = spawnSync("python3", ["-c", py, dir], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const { pairs, model } = await runSeaRaft({
      pairs: [
        {
          pathA: path.join(dir, "a.jpg"),
          pathB: path.join(dir, "b.jpg"),
          frameA: 10,
          frameB: 11,
          width: 384,
          height: 256,
        },
      ],
    });
    assert.equal(model, "sea-raft-s");
    assert.equal(pairs.length, 1);
    const p = pairs[0]!;
    assert.ok(p.grid.length > 0);
    assert.ok(p.paths.length > 0);
    assert.ok(p.mean_motion > 1, `mean ${p.mean_motion}`);
    assert.ok(p.grid.some((c) => c.dx > 8));
    assert.ok(p.paths[0]!.length >= 2);
  });

  it("wires UI → job → worker → sampled vectors + path; block-match is fallback only", () => {
    const worker = fs.readFileSync(seaRaftWorkerPath(), "utf8");
    const providers = fs.readFileSync(path.join(process.cwd(), "src/lib/ai/providers.ts"), "utf8");
    const assist = fs.readFileSync(path.join(process.cwd(), "src/lib/commands/assist-tools.ts"), "utf8");
    const studio = fs.readFileSync(path.join(process.cwd(), "src/components/workstation/studio-app.tsx"), "utf8");
    const overlay = fs.readFileSync(path.join(process.cwd(), "src/lib/visual/overlay-renderer.ts"), "utf8");
    const canvas = fs.readFileSync(path.join(process.cwd(), "src/components/workstation/animation-canvas.tsx"), "utf8");
    assert.match(worker, /Tartan-C368x496-S/);
    assert.match(worker, /sea-raft-s/);
    assert.match(providers, /class SeaRaftProvider/);
    assert.doesNotMatch(providers, /new Reserved\("sea-raft"\)/);
    assert.match(assist, /runSeaRaft/);
    assert.match(assist, /providerName.*=.*sea-raft/);
    assert.match(studio, /provider: "sea-raft"/);
    assert.match(studio, /primary: "motion"/);
    assert.match(overlay, /drawSampledFlow/);
    assert.match(overlay, /drawFlowPaths/);
    assert.match(canvas, /drawSampledFlow/);
    assert.match(canvas, /drawFlowPaths/);
    assert.match(canvas, /paintFlow/);
  });
});
