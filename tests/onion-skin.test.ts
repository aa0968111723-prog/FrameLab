import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  createTimelineState,
  onionNeighbors,
  setOnionSkin,
} from "../src/lib/domain/timeline-engine.ts";
import {
  clampOnionCount,
  clampOnionOpacity,
  onionAlpha,
  onionShouldShow,
} from "../src/lib/visual/onion-draw.ts";
import { computeViewport, viewToFrame } from "../src/lib/visual/viewport.ts";

describe("onion neighbors", () => {
  it("drawing F105 shows F104 and F106", () => {
    const s = setOnionSkin(createTimelineState({ frameCount: 200, currentFrame: 105 }), {
      enabled: true,
      prev: 1,
      next: 1,
    });
    const n = onionNeighbors(105, 200, s.onionSkin);
    assert.deepEqual(n.prev, [104]);
    assert.deepEqual(n.next, [106]);
  });
});

describe("onion visibility and alpha", () => {
  it("shows whenever enabled, even if overlay is original", () => {
    assert.equal(onionShouldShow({ enabled: true, compareActive: false }), true);
    assert.equal(onionShouldShow({ enabled: true, compareActive: true }), false);
    assert.equal(onionShouldShow({ enabled: false, compareActive: false }), false);
  });
  it("clamps layer count and opacity", () => {
    assert.equal(clampOnionCount(0), 0);
    assert.equal(clampOnionCount(9), 3);
    assert.equal(clampOnionOpacity(0), 0.05);
    assert.equal(clampOnionOpacity(1), 0.8);
  });
  it("farther prev neighbors are dimmer", () => {
    const far = onionAlpha("prev", 0, 2, 0.4);
    const near = onionAlpha("prev", 1, 2, 0.4);
    assert.ok(near > far);
  });
});

describe("onion shares viewport with drawing", () => {
  it("frame-space transform matches viewToFrame invert", () => {
    const vt = computeViewport({
      viewWidth: 800,
      viewHeight: 450,
      frameWidth: 320,
      frameHeight: 180,
      zoom: 2,
      panX: 40,
      panY: -12,
    });
    const view = { x: vt.dx + 80 * vt.scale, y: vt.dy + 40 * vt.scale };
    const back = viewToFrame(vt, view.x, view.y);
    assert.ok(Math.abs(back.x - 80) < 1e-9);
    assert.ok(Math.abs(back.y - 40) < 1e-9);
  });
  it("canvas uses enterFrameSpace and draws while onion is on", () => {
    const canvas = fs.readFileSync(path.join(process.cwd(), "src/components/workstation/animation-canvas.tsx"), "utf8");
    assert.match(canvas, /enterFrameSpace/);
    assert.match(canvas, /onionShouldShow/);
    assert.match(canvas, /drawFramePx/);
    assert.doesNotMatch(canvas, /layers\.has\("onion"\) \|\| overlay\.primary === "onion"/);
    assert.match(canvas, /isDrawTool\(tool\)/);
  });
});
