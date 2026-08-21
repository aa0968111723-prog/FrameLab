import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyCurve, applyCustomCurve, sampleCurve } from "../src/lib/domain/motion-curve.ts";
import {
  createTimelineState,
  markBreakdown,
  markKeyframe,
  nextFrame,
  onionNeighbors,
  previousFrame,
  seek,
  selectRange,
  setFrameDurationLocal,
  setOnionSkin,
  unmarkKeyframe,
} from "../src/lib/domain/timeline-engine.ts";
import {
  blendRgba,
  continuityScore,
  detectLocalMaxima,
  histogram16,
  meanAbsDiff,
  pasteRegion,
  type RgbaFrame,
} from "../src/lib/domain/pixel-metrics.ts";
import { sequentialEdges, getFrameWindow, characterNodeId } from "../src/lib/domain/frame-graph.ts";
import { hasScope, parseScopes, assertToolAllowed, isHighRisk } from "../src/lib/domain/permissions.ts";
import { FrameLabError } from "../src/lib/domain/errors.ts";
import type { FrameRecord } from "../src/lib/domain/types.ts";

function solid(w: number, h: number, r: number, g: number, b: number): RgbaFrame {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

describe("motion curve", () => {
  it("clamps and hits endpoints", () => {
    assert.equal(applyCurve(0, "linear"), 0);
    assert.equal(applyCurve(1, "linear"), 1);
    assert.equal(applyCurve(-1, "ease_in"), 0);
    assert.equal(applyCurve(2, "ease_out"), 1);
  });
  it("ease_in is below linear at mid", () => {
    assert.ok(applyCurve(0.5, "ease_in") < 0.5);
    assert.ok(applyCurve(0.5, "ease_out") > 0.5);
  });
  it("hold stays zero until the end", () => {
    assert.equal(applyCurve(0.9, "hold"), 0);
    assert.equal(applyCurve(1, "hold"), 1);
  });
  it("samples count inbetweens", () => {
    assert.equal(sampleCurve(3, "linear").length, 3);
    assert.ok(Math.abs(sampleCurve(1, "linear")[0] - 0.5) < 1e-9);
  });
  it("custom knots are piecewise linear", () => {
    assert.equal(applyCustomCurve(0, [0, 1]), 0);
    assert.equal(applyCustomCurve(1, [0, 1]), 1);
  });
});

describe("timeline engine", () => {
  it("seeks and clamps", () => {
    let s = createTimelineState({ frameCount: 10, currentFrame: 0 });
    s = seek(s, 4);
    assert.equal(s.currentFrame, 4);
    s = seek(s, 99);
    assert.equal(s.currentFrame, 9);
    s = previousFrame(s);
    assert.equal(s.currentFrame, 8);
    s = nextFrame(s);
    assert.equal(s.currentFrame, 9);
  });
  it("selects ranges", () => {
    const s = selectRange(createTimelineState({ frameCount: 12 }), 3, 6);
    assert.deepEqual(s.selectedFrames, [3, 4, 5, 6]);
  });
  it("onion neighbors respect bounds", () => {
    const s = setOnionSkin(createTimelineState({ frameCount: 5, currentFrame: 0 }), {
      enabled: true,
      prev: 2,
      next: 2,
    });
    const n = onionNeighbors(0, 5, s.onionSkin);
    assert.deepEqual(n.prev, []);
    assert.deepEqual(n.next, [1, 2]);
  });
  it("toggles onion layers independently", () => {
    const s = setOnionSkin(createTimelineState({ frameCount: 8, currentFrame: 4 }), {
      layers: { prev3: true, prev2: false, prev1: true, next1: false, next2: true, next3: true },
      prev: 2,
      next: 2,
      enabled: true,
    });
    const n = onionNeighbors(4, 8, s.onionSkin);
    assert.deepEqual(n.prev, [3]);
    assert.deepEqual(n.next, [6]);
  });
  it("onion neighbors include the third slot when prev/next is 3", () => {
    const s = setOnionSkin(createTimelineState({ frameCount: 12, currentFrame: 5 }), {
      enabled: true,
      prev: 3,
      next: 3,
    });
    const n = onionNeighbors(5, 12, s.onionSkin);
    assert.deepEqual(n.prev, [2, 3, 4]);
    assert.deepEqual(n.next, [6, 7, 8]);
  });
  it("marks keyframes on the engine", () => {
    let s = createTimelineState({ frameCount: 10 });
    s = markKeyframe(s, 3);
    s = markKeyframe(s, 8);
    assert.deepEqual(s.keyframes, [3, 8]);
    s = unmarkKeyframe(s, 3);
    assert.deepEqual(s.keyframes, [8]);
  });
  it("stores local duration and breakdowns", () => {
    let s = createTimelineState({ frameCount: 10 });
    s = setFrameDurationLocal(s, 2, 80);
    assert.equal(s.durations[2], 80);
    s = markBreakdown(s, 4);
    assert.deepEqual(s.breakdowns, [4]);
  });
});

describe("pixel metrics", () => {
  it("identical frames have zero diff and full continuity", () => {
    const a = solid(8, 8, 10, 20, 30);
    assert.equal(meanAbsDiff(a, a), 0);
    assert.equal(continuityScore(0), 1);
  });
  it("opposite frames differ", () => {
    const a = solid(4, 4, 0, 0, 0);
    const b = solid(4, 4, 255, 255, 255);
    assert.ok(meanAbsDiff(a, b) > 0.99);
  });
  it("histogram sums to 1", () => {
    const h = histogram16(solid(4, 4, 255, 0, 0));
    const sum = h.r.reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
  });
  it("blend midpoint is average", () => {
    const a = solid(2, 2, 0, 0, 0);
    const b = solid(2, 2, 200, 100, 0);
    const m = blendRgba(a, b, 0.5);
    assert.equal(m.data[0], 100);
    assert.equal(m.data[1], 50);
  });
  it("detects local maxima", () => {
    assert.deepEqual(detectLocalMaxima([0, 1, 0, 2, 0], 0.5), [1, 3]);
  });
  it("pastes a region without touching the rest", () => {
    const dest = solid(4, 4, 0, 0, 0);
    const src = solid(4, 4, 200, 0, 0);
    const out = pasteRegion(dest, src, { x: 1, y: 1, w: 1, h: 1 });
    assert.equal(out.data[0], 0);
    const i = (1 * 4 + 1) * 4;
    assert.equal(out.data[i], 200);
  });
});

describe("frame graph", () => {
  const frames: FrameRecord[] = [0, 1, 2].map((n) => ({
    id: `f${n}`,
    timelineId: "t",
    frameNumber: n,
    timestampMs: n * 40,
    durationMs: 40,
    frameType: "INBETWEEN",
    imageData: "",
    thumbnailData: "",
    width: 8,
    height: 8,
    isLocked: false,
    notes: "",
    contentHash: "",
  }));
  it("builds next/prev edges", () => {
    const e = sequentialEdges(frames);
    assert.equal(e.filter((x) => x.type === "NEXT_FRAME").length, 2);
    assert.equal(e.filter((x) => x.type === "PREVIOUS_FRAME").length, 2);
  });
  it("windows around a center", () => {
    const w = getFrameWindow(frames, 1, 1, 1);
    assert.deepEqual(w.map((f) => f.frameNumber), [0, 1, 2]);
  });
  it("builds character node ids", () => {
    assert.equal(characterNodeId("xiaohua", "frm_1"), "xiaohua@frm_1");
  });
});

describe("permissions", () => {
  it("parses scopes and admin bypass", () => {
    const s = parseScopes("READ, ANALYZE");
    assert.ok(hasScope(s, "READ"));
    assert.equal(hasScope(s, "EDIT"), false);
    assert.equal(hasScope(["ADMIN"], "GENERATE"), true);
  });
  it("blocks tools outside scope", () => {
    assert.throws(
      () => assertToolAllowed(["READ"], "delete_frame"),
      FrameLabError,
    );
    assertToolAllowed(["EDIT"], "delete_frame");
    assert.equal(isHighRisk("delete_frame"), true);
    assert.equal(isHighRisk("get_frame"), false);
  });
});
