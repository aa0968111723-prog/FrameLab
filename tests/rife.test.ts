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

  it("interpolates a midpoint between two circles (centroid near 64, not a linear blend)", async () => {
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
    const cent = spawnSync(
      "python3",
      [
        "-c",
        `
import cv2, numpy as np, sys
img=cv2.imread(sys.argv[1])
mask=cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)>20
ys,xs=np.where(mask)
print(float(xs.mean()), float(ys.mean()), int(mask.sum()))
`,
        frames[0]!.path,
      ],
      { encoding: "utf8" },
    );
    assert.equal(cent.status, 0, cent.stderr);
    const [cx, cy, area] = cent.stdout.trim().split(/\s+/).map(Number);
    assert.ok(area > 200, `midpoint has almost no subject: area=${area}`);
    assert.ok(Math.abs(cx - 64) < 8, `centroid x=${cx} expected ~64`);
    assert.ok(Math.abs(cy - 48) < 8, `centroid y=${cy} expected ~48`);
  });

  it("wires Key A/B → candidate → preview → accept; linear-blend is 快速預覽 not AI", () => {
    const providers = fs.readFileSync(path.join(process.cwd(), "src/lib/ai/providers.ts"), "utf8");
    const tools = fs.readFileSync(path.join(process.cwd(), "src/lib/commands/inbetween-tools.ts"), "utf8");
    const studio = fs.readFileSync(path.join(process.cwd(), "src/components/workstation/studio-app.tsx"), "utf8");
    const panel = fs.readFileSync(path.join(process.cwd(), "src/components/workstation/inbetween-panel.tsx"), "utf8");
    const catalog = fs.readFileSync(path.join(process.cwd(), "src/lib/mcp/catalog.ts"), "utf8");
    assert.match(providers, /class RifeInbetween/);
    assert.match(providers, /runRife/);
    assert.match(tools, /getInbetween\("rife"\)/);
    assert.match(studio, /quality: "production"/);
    assert.match(studio, /provider: inb.quality === "preview" \? "linear-blend" : "rife"/);
    assert.match(studio, /accept_generated_frames/);
    assert.match(studio, /reject_generated_frames/);
    assert.match(panel, /快速預覽（非 AI）/);
    assert.match(panel, /RIFE 中割/);
    assert.match(panel, /不是 AI 中割/);
    assert.doesNotMatch(panel, /供應商：自動（線性混合）/);
    assert.match(catalog, /provider=rife quality=production/);
    assert.doesNotMatch(catalog, /Do not claim RIFE/);
    assert.match(catalog, /linear-blend is 快速預覽/);
  });
});
