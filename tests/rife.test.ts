import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { probeRife, rifeWorkerPath, runRife } from "../src/lib/ai/rife-worker.ts";

describe("RIFE worker", () => {
  it("health is ready", () => {
    const h = probeRife();
    assert.equal(h.ok, true, h.error);
    assert.equal(h.provider, "rife");
  });

  it("interpolates a midpoint between two circles", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rife-"));
    const py = `
import cv2, numpy as np, json, sys
out=sys.argv[1]
H,W=96,128
a=np.zeros((H,W,3), np.uint8); b=np.zeros((H,W,3), np.uint8)
cv2.circle(a,(40,48),18,(40,200,255),-1)
cv2.circle(b,(88,48),18,(40,200,255),-1)
cv2.imwrite(f"{out}/a.jpg", a)
cv2.imwrite(f"{out}/b.jpg", b)
print("ok")
`;
    const r = spawnSync("python3", ["-c", py, dir], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const { frames, model } = await runRife({
      pathA: path.join(dir, "a.jpg"),
      pathB: path.join(dir, "b.jpg"),
      count: 1,
      timesteps: [0.5],
      outDir: path.join(dir, "out"),
    });
    assert.equal(model, "rife-4.25");
    assert.equal(frames.length, 1);
    assert.ok(fs.existsSync(frames[0]!.path));
  });

  it("wires Key A/B → candidate → preview → accept; linear-blend is 快速預覽 not AI", () => {
    const providers = fs.readFileSync(path.join(process.cwd(), "src/lib/ai/providers.ts"), "utf8");
    const tools = fs.readFileSync(path.join(process.cwd(), "src/lib/commands/inbetween-tools.ts"), "utf8");
    const studio = fs.readFileSync(path.join(process.cwd(), "src/components/workstation/studio-app.tsx"), "utf8");
    const panel = fs.readFileSync(path.join(process.cwd(), "src/components/workstation/inbetween-panel.tsx"), "utf8");
    assert.match(providers, /class RifeInbetween/);
    assert.match(providers, /runRife/);
    assert.match(tools, /getInbetween\("rife"\)/);
    assert.match(studio, /provider: inb.quality === "preview" \? "linear-blend" : "rife"/);
    assert.match(studio, /accept_generated_frames/);
    assert.match(studio, /reject_generated_frames/);
    assert.match(panel, /快速預覽（非 AI）/);
    assert.match(panel, /RIFE 中割/);
    assert.match(panel, /不是 AI 中割/);
    assert.doesNotMatch(panel, /供應商：自動（線性混合）/);
  });
});
