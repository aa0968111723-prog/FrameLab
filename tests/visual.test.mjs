import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeViewport,
  frameToView,
  viewToFrame,
  normToView,
  panToNormRegion,
  suggestedFocusZoom,
  zoom100Percent,
} from "../src/lib/visual/viewport.ts";
import {
  timelineWindow,
  cellWidthForZoom,
  mergeProblemSpans,
  frameTypeMark,
  frameAtX,
  keyBreakdownFlow,
  maskTrackMarks,
} from "../src/lib/visual/timeline-virtual.ts";
import {
  annotationsFromProblems,
  isVisualAnnotation,
  pointAnnotation,
  regionAnnotation,
  rangeAnnotation,
  toNormalized,
  mapAiAnnotation,
} from "../src/lib/domain/visual-annotation.ts";
import {
  motionPathPoints,
  pickTrailName,
  hitAnnotation,
  inferContact,
  poseScreenPoints,
} from "../src/lib/visual/overlay-renderer.ts";
import { locateProblemBox, neighborRange } from "../src/lib/visual/problem-locate.ts";
import { buildPresence, trackingBreaks } from "../src/lib/visual/character-track.ts";
import { neighborIds, sampleStripIndices } from "../src/lib/visual/thumbnail-cache.ts";
import { spacingDots, curvePathD, curveCaption } from "../src/lib/visual/motion-curve-visual.ts";
import {
  activeOverlays,
  defaultOverlayForMode,
  matchesProblemFilter,
  setPrimary,
  toggleExtra,
} from "../src/lib/visual/workspace-mode.ts";
import { propagateMask, constraintHonesty } from "../src/lib/domain/region-repair.ts";
import { regionBoxFromDrag, isUsableRegionBox } from "../src/lib/visual/region-box.ts";

describe("viewport transform", () => {
  it("round-trips frame ↔ view", () => {
    const vt = computeViewport({
      viewWidth: 800,
      viewHeight: 450,
      frameWidth: 320,
      frameHeight: 180,
      zoom: 1,
      panX: 12,
      panY: -8,
    });
    const v = frameToView(vt, 80, 40);
    const back = viewToFrame(vt, v.x, v.y);
    assert.ok(Math.abs(back.x - 80) < 1e-6);
    assert.ok(Math.abs(back.y - 40) < 1e-6);
  });

  it("keeps normalized overlays aligned after zoom/pan", () => {
    const a = computeViewport({ viewWidth: 640, viewHeight: 360, frameWidth: 320, frameHeight: 180, zoom: 1, panX: 0, panY: 0 });
    const b = computeViewport({ viewWidth: 640, viewHeight: 360, frameWidth: 320, frameHeight: 180, zoom: 2.4, panX: 40, panY: -20 });
    const pa = normToView(a, 0.5, 0.5);
    const pb = normToView(b, 0.5, 0.5);
    const fa = viewToFrame(a, pa.x, pa.y);
    const fb = viewToFrame(b, pb.x, pb.y);
    assert.ok(Math.abs(fa.x - fb.x) < 1e-6);
    assert.ok(Math.abs(fa.y - fb.y) < 1e-6);
  });

  it("focus pan centers a region", () => {
    const p = panToNormRegion({
      viewWidth: 800,
      viewHeight: 400,
      frameWidth: 200,
      frameHeight: 100,
      zoom: 2,
      region: { x: 0.7, y: 0.2, w: 0.2, h: 0.2 },
    });
    assert.equal(typeof p.panX, "number");
    assert.equal(typeof p.panY, "number");
    assert.ok(suggestedFocusZoom({ w: 0.2, h: 0.2 }) > 1);
    assert.ok(zoom100Percent(800, 400, 400, 200) > 0);
  });
});

describe("timeline virtualization", () => {
  it("does not grow DOM linearly with frame count", () => {
    for (const total of [100, 500, 1000, 5000, 10000]) {
      const win = timelineWindow({ scrollLeft: 2400, containerWidth: 800, cellWidth: 40, total });
      assert.ok(win.visibleCount < 80, `visible ${win.visibleCount} for ${total}`);
      assert.equal(win.totalWidth, total * 40);
      assert.ok(win.end - win.start === win.visibleCount);
    }
  });

  it("maps x to frame and merges problem spans", () => {
    assert.equal(frameAtX(85, 40, 10), 2);
    const merged = mergeProblemSpans([
      { start: 4, end: 6, severity: "warning" },
      { start: 6, end: 8, severity: "error" },
      { start: 20, end: 21, severity: "info" },
    ]);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].end, 8);
    assert.equal(merged[0].severity, "error");
    assert.equal(frameTypeMark("KEY").glyph, "★");
    assert.equal(frameTypeMark("BREAKDOWN").glyph, "◆");
    assert.equal(frameTypeMark("INBETWEEN").glyph, "●");
    assert.equal(frameTypeMark("GENERATED").glyph, "生");
    assert.ok(cellWidthForZoom(2) > cellWidthForZoom(0.5));
  });

  it("draws key → breakdown → key flow", () => {
    const flow = keyBreakdownFlow([
      { frameNumber: 0, frameType: "KEY" },
      { frameNumber: 4, frameType: "BREAKDOWN" },
      { frameNumber: 8, frameType: "KEY" },
      { frameNumber: 9, frameType: "GENERATED" },
    ]);
    assert.equal(flow[0].breakdown, 4);
    assert.equal(flow[0].nextKey, 8);
    const marks = maskTrackMarks([
      { frame: 1, confidence: 0.9 },
      { frame: 2, confidence: 0.2, lost: true },
    ]);
    assert.equal(marks[1].status, "lost");
  });
});

describe("visual annotations", () => {
  it("maps problems to range + region + pointer", () => {
    const anns = annotationsFromProblems(
      [{ start: 105, end: 107, peak_frame: 106, category: "HAND", severity: "warning", reason: "jump" }],
      () => ({ x: 0.6, y: 0.3, w: 0.2, h: 0.2 }),
    );
    assert.equal(anns.length, 3);
    assert.equal(anns[0].type, "RANGE");
    assert.equal(anns[1].type, "REGION");
    assert.equal(anns[2].type, "POINT");
    assert.ok(isVisualAnnotation(anns[1]));
    assert.deepEqual(anns[0].coordinates, [105, 107]);
    const onlyRange = annotationsFromProblems(
      [{ start: 105, end: 107, peak_frame: 106, category: "HAND", severity: "warning", reason: "jump" }],
      () => null,
    );
    assert.equal(onlyRange.length, 1);
    assert.equal(onlyRange[0].type, "RANGE");
  });

  it("rejects DOM commands as annotations", () => {
    assert.equal(mapAiAnnotation({ id: "x", css: ".foo" }), null);
    const p = pointAnnotation("a", 3, 1.4, -0.2, "here");
    assert.equal(p.coordinates[0], 1);
    assert.equal(p.coordinates[1], 0);
    const r = regionAnnotation("b", 3, { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, "hand");
    assert.equal(r.type, "REGION");
    const rng = rangeAnnotation("c", 4, 8, "range");
    assert.equal(rng.type, "RANGE");
  });

  it("normalizes pixel coords", () => {
    const n = toNormalized(80, 40, 160, 80);
    assert.equal(n.x, 0.5);
    assert.equal(n.y, 0.5);
    const already = toNormalized(0.2, 0.3, 160, 80);
    assert.equal(already.x, 0.2);
  });
});

describe("overlays", () => {
  it("builds a motion trail and hits an annotation", () => {
    const vt = computeViewport({ viewWidth: 400, viewHeight: 200, frameWidth: 100, frameHeight: 50, zoom: 1, panX: 0, panY: 0 });
    const tracking = [
      { name: "right_wrist", x: 10, y: 10, frame_number: 0 },
      { name: "right_wrist", x: 20, y: 12, frame_number: 1 },
      { name: "right_wrist", x: 80, y: 12, frame_number: 2, status: "lost" },
    ];
    const pts = motionPathPoints(tracking, vt, "right_wrist");
    assert.equal(pts.length, 3);
    assert.equal(pts[2].problem, true);
    assert.equal(pickTrailName(tracking, "right_hand"), "right_wrist");
    const ann = regionAnnotation("r", 1, { x: 0, y: 0, w: 1, h: 1 }, "all");
    const hit = hitAnnotation(vt, [ann], 1, vt.dx + 10, vt.dy + 10);
    assert.equal(hit?.id, "r");
  });

  it("pose points stay on the same transform", () => {
    const vt = computeViewport({ viewWidth: 400, viewHeight: 200, frameWidth: 100, frameHeight: 100, zoom: 1.5, panX: 5, panY: 5 });
    const map = poseScreenPoints(vt, [{ name: "nose", x: 50, y: 50, confidence: 1 }]);
    const p = map.get("nose");
    const back = viewToFrame(vt, p.x, p.y);
    assert.ok(Math.abs(back.x - 50) < 0.01);
  });

  it("detects contact break", () => {
    const c = inferContact(
      [
        { name: "right_hand", x: 10, y: 10, frame_number: 6, status: "visible" },
        { name: "suitcase", x: 90, y: 90, frame_number: 6, status: "lost" },
      ],
      6,
      100,
      100,
    );
    assert.equal(c.broken, true);
  });
});

describe("region + mask", () => {
  it("builds a usable drag box", () => {
    const box = regionBoxFromDrag(10, 10, 40, 50, 80, 80);
    assert.equal(box.w, 30);
    assert.equal(box.h, 40);
    assert.equal(isUsableRegionBox(box), true);
    assert.equal(isUsableRegionBox({ x: 0, y: 0, w: 2, h: 2 }), false);
  });

  it("propagates a mask along a track", () => {
    const out = propagateMask(
      { frame: 5, x: 10, y: 10, w: 20, h: 20 },
      [4, 5, 6],
      [
        { frame_number: 5, x: 10, y: 10, score: 0.9 },
        { frame_number: 6, x: 18, y: 12, score: 0.8 },
      ],
    );
    assert.equal(out[2].mask.x, 18);
    assert.equal(out[0].lost, true);
    const hon = constraintHonesty("Face", { pose: false });
    assert.equal(hon.guaranteed, false);
  });
});

describe("problem locate + strips + cache", () => {
  it("places a hand problem on the wrist", () => {
    const box = locateProblemBox({
      category: "HAND",
      frameNumber: 3,
      frameWidth: 100,
      frameHeight: 100,
      joints: [{ name: "right_wrist", x: 80, y: 40, confidence: 0.9 }],
    });
    assert.ok(box.x > 0.5);
    assert.deepEqual(neighborRange(10, 24, 2), [8, 12]);
    const missing = locateProblemBox({
      category: "HAND",
      frameNumber: 3,
      frameWidth: 100,
      frameHeight: 100,
    });
    assert.equal(missing, null);
  });

  it("preloads neighbors and samples strips", () => {
    const frames = Array.from({ length: 24 }, (_, i) => ({ id: `f${i}`, frameNumber: i }));
    const ids = neighborIds(frames, 10, 2);
    assert.equal(ids.length, 5);
    assert.equal(sampleStripIndices(24, 6).length, 6);
  });

  it("finds character tracking breaks", () => {
    const rows = buildPresence([
      { character_id: "c1", name: "Hua", frame_number: 0 },
      { character_id: "c1", name: "Hua", frame_number: 1 },
      { character_id: "c1", name: "Hua", frame_number: 4 },
    ]);
    const breaks = trackingBreaks(rows[0].frames, 5);
    assert.equal(breaks[0].start, 2);
    assert.equal(breaks[0].end, 3);
  });
});

describe("workspace + motion visuals", () => {
  it("never stacks every overlay by default", () => {
    const s = defaultOverlayForMode("ANALYZE");
    const active = activeOverlays(s);
    assert.equal(active.has("problems"), true);
    assert.equal(active.has("flow"), false);
    const stacked = toggleExtra(setPrimary(s, "original"), "pose");
    assert.equal(stacked.primary, "original");
    assert.ok(stacked.extras.includes("pose"));
    assert.equal(matchesProblemFilter("HAND", "Hand"), true);
    assert.equal(matchesProblemFilter("FACE", "Motion"), false);
  });

  it("visualizes spacing for ease in/out", () => {
    const easeIn = spacingDots(5, "ease_in");
    const easeOut = spacingDots(5, "ease_out");
    assert.ok(easeIn[1] < easeOut[1]);
    assert.ok(curvePathD("linear").startsWith("M"));
    assert.match(curveCaption("ease_in"), /緩入/);
  });
});
