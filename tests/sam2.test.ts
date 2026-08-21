import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { probeSam2, runSam2, sam2WorkerPath } from "../src/lib/ai/sam2-worker.ts";
import { TOOL_SCOPES } from "../src/lib/domain/permissions.ts";
import { isAskToolAllowed, isAssistToolAllowed } from "../src/lib/domain/conversation.ts";
import { MCP_TOOLS } from "../src/lib/mcp/catalog.ts";
import { mapRestPath } from "../src/lib/framelab/rest-map.ts";

describe("SAM 2 worker", () => {
  it("health is ready", () => {
    const h = probeSam2();
    assert.equal(h.ok, true, h.error);
    assert.equal(h.provider, "sam2");
  });

  it("clicks a blob and returns a real mask", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sam2-"));
    const py = `
import cv2, numpy as np, json, sys
out=sys.argv[1]
frames=[]
for t in range(4):
    img=np.zeros((120,160,3), np.uint8)
    x=30+t*18; y=44
    cv2.circle(img, (x+12, y+12), 14, (240,240,240), -1)
    p=f"{out}/f{t:02d}.jpg"
    cv2.imwrite(p, img)
    frames.append({"id":f"f{t}","path":p,"frameNumber":t,"width":160,"height":120})
print(json.dumps(frames))
`;
    const r = spawnSync("python3", ["-c", py, dir], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const frames = JSON.parse(r.stdout.trim().split("\n").at(-1) || "[]") as {
      id: string;
      path: string;
      frameNumber: number;
      width: number;
      height: number;
    }[];
    const out = await runSam2({
      frames,
      click: { x: 42, y: 56, frameNumber: 0 },
      objectId: "blob",
      direction: "both",
    });
    assert.equal(out.model, "sam2.1-hiera-tiny");
    assert.ok(out.masks.length >= 1, "expected at least the seed mask");
    const seed = out.masks.find((m) => m.frameNumber === 0);
    assert.ok(seed, "seed frame missing");
    assert.ok(seed!.area > 0.01, `seed area ${seed!.area}`);
    assert.ok(seed!.contour.length >= 3, "need a real contour, not a box stub");
    const last = out.masks.find((m) => m.frameNumber === out.masks.at(-1)!.frameNumber);
    assert.ok(last);
    if (out.masks.length > 1) {
      const xs = out.masks.map((m) => m.bbox.x + m.bbox.w / 2);
      assert.ok(xs.at(-1)! > xs[0]!, `mask should follow the blob ${xs}`);
    }
  });

  it("warns instead of faking success on a dead click", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sam2-empty-"));
    const py = `
import cv2, numpy as np, json, sys
out=sys.argv[1]
img=np.zeros((80,80,3), np.uint8)
p=f"{out}/f0.jpg"
cv2.imwrite(p, img)
print(json.dumps([{"id":"f0","path":p,"frameNumber":0,"width":80,"height":80}]))
`;
    const r = spawnSync("python3", ["-c", py, dir], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const frames = JSON.parse(r.stdout.trim().split("\n").at(-1) || "[]") as {
      id: string;
      path: string;
      frameNumber: number;
      width: number;
      height: number;
    }[];
    let out;
    try {
      out = await runSam2({
        frames,
        click: { x: 4, y: 4, frameNumber: 0 },
        objectId: "empty",
        direction: "both",
      });
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.match(err.message, /empty mask|failed|Not a success/i);
      return;
    }
    const seed = out.masks.find((m) => m.frameNumber === 0);
    assert.ok(seed);
    assert.notEqual(seed!.status, "ok");
    assert.ok(out.degraded || out.warnings.length > 0 || seed!.status === "lost" || seed!.status === "warn");
  });

  it("wires click → job → worker → DB → canvas; not a reserved stub", () => {
    const worker = fs.readFileSync(sam2WorkerPath(), "utf8");
    const exec = fs.readFileSync(path.join(process.cwd(), "src/lib/commands/execute.ts"), "utf8");
    const cmd = fs.readFileSync(path.join(process.cwd(), "src/lib/commands/sam2-tools.ts"), "utf8");
    const providers = fs.readFileSync(path.join(process.cwd(), "src/lib/ai/providers.ts"), "utf8");
    const studio = fs.readFileSync(path.join(process.cwd(), "src/components/workstation/studio-app.tsx"), "utf8");
    const overlay = fs.readFileSync(path.join(process.cwd(), "src/lib/visual/overlay-renderer.ts"), "utf8");
    assert.match(worker, /SAM2VideoPredictor/);
    assert.match(worker, /propagate_in_video/);
    assert.match(worker, /reverse=True/);
    assert.match(worker, /status.: "warn"|status = "warn"|return "warn"/);
    assert.doesNotMatch(worker, /fake mask/);
    assert.match(exec, /segmentObjectCmd/);
    assert.match(cmd, /SEGMENTATION/);
    assert.match(providers, /class Sam2Provider/);
    assert.doesNotMatch(providers, /new Reserved\("sam2"\)/);
    assert.match(studio, /tool: "segment_object"/);
    assert.match(studio, /未假裝成功/);
    assert.match(studio, /direction: "both"/);
    assert.match(overlay, /drawMaskOverlay/);
    assert.equal(TOOL_SCOPES.segment_object, "ANALYZE");
    assert.equal(isAskToolAllowed("segment_object"), false);
    assert.equal(isAssistToolAllowed("segment_object"), true);
    assert.ok(MCP_TOOLS.some((t) => t.name === "segment_object"));
    assert.equal(mapRestPath("POST", "/api/v1/masks", {})?.tool, "segment_object");
  });
});
