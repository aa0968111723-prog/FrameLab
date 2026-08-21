import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  ContextResolver,
  ContextSerializer,
  clearSelectedRegion,
  createEmptyContext,
  effectiveContext,
  hydrateContext,
  isStaleContext,
  lockContext,
  normalizeRegion,
  paddedNormalizedRegion,
  pixelsFromNormalized,
  normalizedFromPixels,
  resolveAskContext,
  resolveFocus,
  serializeContext,
  setCurrentFrame,
  setOnionSkinContext,
  setSelectedRange,
  setSelectedRegion,
  unlockContext,
} from "../src/lib/domain/context-engine.ts";
import {
  comparePair,
  cropRgba,
  LIGHTWEIGHT_KIND,
  lumaCentroid,
  ssimLike,
  summarizeObservations,
} from "../src/lib/domain/lightweight-analysis.ts";
import {
  buildConversationPrompt,
  buildFallbackAskReply,
  ConversationContextBuilder,
  isAskToolAllowed,
  parseSuggestedActions,
} from "../src/lib/domain/conversation.ts";

const engineSrc = readFileSync(new URL("../src/lib/domain/context-engine.ts", import.meta.url), "utf8");
const analysisSrc = readFileSync(new URL("../src/lib/domain/lightweight-analysis.ts", import.meta.url), "utf8");

function solid(w, h, r, g, b) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

describe("context engine (live module)", () => {
  it("updates current frame and bumps version", () => {
    let ctx = createEmptyContext({ projectId: "p1", timelineId: "t1" });
    const v0 = ctx.contextVersion;
    ctx = setCurrentFrame(ctx, { id: "f10", frameNumber: 10, timestampMs: 400 });
    assert.equal(ctx.currentFrame.frameNumber, 10);
    assert.ok(ctx.contextVersion > v0);
    assert.equal(resolveFocus(ctx), "current_frame");
  });

  it("selects a frame range", () => {
    let ctx = createEmptyContext({ projectId: "p1" });
    ctx = setSelectedRange(ctx, 8, 12, { id: "f10", frameNumber: 10, timestampMs: 0 });
    assert.deepEqual(ctx.selectedRange, { startFrame: 8, endFrame: 12 });
    assert.deepEqual(ctx.selectedFrames, [8, 9, 10, 11, 12]);
    assert.equal(resolveFocus(ctx), "selected_frame_range");
  });

  it("stores a normalized region and prefers it as focus", () => {
    let ctx = createEmptyContext({ projectId: "p1" });
    ctx = setCurrentFrame(ctx, { id: "f10", frameNumber: 10, timestampMs: 0 });
    ctx = setSelectedRegion(ctx, {
      type: "rectangle",
      selectionType: "rectangle",
      frameId: "f10",
      frameNumber: 10,
      x: -0.2,
      y: 0.1,
      width: 2,
      height: 0.2,
    });
    assert.equal(ctx.selectedRegion.x, 0);
    assert.ok(ctx.selectedRegion.width <= 1);
    assert.equal(resolveFocus(ctx), "selected_region");
  });

  it("serializes and hydrates", () => {
    let ctx = createEmptyContext({ projectId: "p1" });
    ctx = setCurrentFrame(ctx, { id: "f5", frameNumber: 5, timestampMs: 200 });
    ctx = setSelectedRange(ctx, 3, 7, ctx.currentFrame);
    const snap = serializeContext(ctx);
    assert.equal(snap.project_id, "p1");
    assert.equal(snap.current_frame, 5);
    assert.deepEqual(snap.selected_range, [3, 7]);
    assert.ok("viewport" in snap);
    const back = hydrateContext(snap);
    assert.equal(back.projectId, "p1");
    assert.equal(back.currentFrame.frameNumber, 5);
    assert.deepEqual(back.selectedRange, { startFrame: 3, endFrame: 7 });
    assert.equal(ContextSerializer.serialize(ctx).current_frame, 5);
  });

  it("locks context so live seeks do not change the frozen snapshot", () => {
    let live = createEmptyContext({ projectId: "p1" });
    live = setCurrentFrame(live, { id: "f10", frameNumber: 10, timestampMs: 0 });
    live = setSelectedRange(live, 8, 12, live.currentFrame);
    const lock = lockContext(live);
    live = setCurrentFrame(live, { id: "f20", frameNumber: 20, timestampMs: 0 });
    const frozen = effectiveContext(live, lock);
    assert.equal(frozen.currentFrame.frameNumber, 10);
    assert.equal(live.currentFrame.frameNumber, 20);
    assert.equal(effectiveContext(live, unlockContext()).currentFrame.frameNumber, 20);
  });

  it("marks stale answers when context_version moved", () => {
    assert.equal(isStaleContext(14, 20, { locked: false, snapshot: null }), true);
    assert.equal(isStaleContext(14, 20, { locked: true, snapshot: null }), false);
    assert.equal(isStaleContext(20, 20, { locked: false, snapshot: null }), false);
  });

  it("caps onion skin at 3 in the domain module", () => {
    let ctx = createEmptyContext();
    ctx = setOnionSkinContext(ctx, { previousFrames: 9, nextFrames: 9 });
    assert.equal(ctx.onionSkin.previousFrames, 3);
    assert.equal(ctx.onionSkin.nextFrames, 3);
  });

  it("converts pixels ↔ normalized 0–1", () => {
    const region = normalizedFromPixels(
      { x: 50, y: 10, w: 40, h: 20 },
      200,
      100,
      { frameId: "f1", frameNumber: 1 },
    );
    assert.equal(region.x, 0.25);
    const px = pixelsFromNormalized(region, 200, 100);
    assert.equal(px.x, 50);
    const padded = paddedNormalizedRegion(region, 0.15);
    assert.ok(padded.width > region.width);
    const n = normalizeRegion({ ...region, x: -1, width: 4 });
    assert.equal(n.x, 0);
    assert.ok(n.width <= 1);
  });

  it("resolver prefers region over range over frame", () => {
    let ctx = createEmptyContext({ projectId: "p", timelineId: "t" });
    ctx = setCurrentFrame(ctx, { id: "f10", frameNumber: 10, timestampMs: 0 });
    ctx = setSelectedRange(ctx, 8, 12, ctx.currentFrame);
    ctx = setSelectedRegion(ctx, {
      type: "rectangle",
      selectionType: "rectangle",
      frameId: "f10",
      frameNumber: 10,
      x: 0.4,
      y: 0.3,
      width: 0.2,
      height: 0.2,
    });
    const ask = ContextResolver.resolve(ctx, 24);
    assert.equal(ask.focus, "selected_region");
    assert.deepEqual(ask.range, [8, 12]);
    assert.ok(ask.neighbors.includes(10));
    ctx = clearSelectedRegion(ctx);
    assert.equal(resolveAskContext(ctx, 24).focus, "selected_frame_range");
  });
});

describe("lightweight visual analysis (live module)", () => {
  it("is labelled as lightweight, never pose", () => {
    assert.equal(LIGHTWEIGHT_KIND, "lightweight visual analysis");
    assert.match(analysisSrc, /No pose \/ skeleton/);
    assert.match(analysisSrc, /Do not report joint angles/);
  });

  it("compares two synthetic frames with real pixel metrics", () => {
    const a = solid(16, 16, 10, 10, 10);
    const b = solid(16, 16, 200, 20, 20);
    const obs = comparePair(a, b, 10, 11);
    const kinds = new Set(obs.map((o) => o.kind));
    for (const k of ["mae", "histogram", "luma", "edge", "ssim_like", "centroid", "motion_block"]) {
      assert.ok(kinds.has(k), k);
    }
    const mae = obs.find((o) => o.kind === "mae");
    assert.ok(mae.value > 0.2);
    const report = summarizeObservations(obs, [10, 11], true);
    assert.equal(report.kind, LIGHTWEIGHT_KIND);
    assert.match(report.summary, /selected region|F10/);
    assert.ok(report.limitations.length > 0);
    const crop = cropRgba(b, { x: 0, y: 0, w: 4, h: 4 });
    assert.equal(crop.width, 4);
    assert.ok(ssimLike(a, a) > ssimLike(a, b));
    const c = lumaCentroid(a);
    assert.ok(c.x >= 0 && c.x <= 1);
  });
});

describe("conversation prompt + ASK tools (live module)", () => {
  it("builds a structured prompt from context", () => {
    let ctx = createEmptyContext({ projectId: "proj", timelineId: "tl" });
    ctx = setCurrentFrame(ctx, { id: "f135", frameNumber: 135, timestampMs: 5625 });
    ctx = setSelectedRange(ctx, 130, 140, ctx.currentFrame);
    ctx = setSelectedRegion(ctx, {
      type: "rectangle",
      selectionType: "rectangle",
      frameId: "f135",
      frameNumber: 135,
      x: 0.42,
      y: 0.31,
      width: 0.18,
      height: 0.24,
    });
    const built = buildConversationPrompt({
      ctx,
      userMessage: "這裡為什麼怪怪的？",
      fps: 24,
    });
    assert.match(built.contextBlock, /CURRENT PROJECT/);
    assert.match(built.contextBlock, /CURRENT FRAME/);
    assert.match(built.contextBlock, /SELECTED RANGE/);
    assert.match(built.contextBlock, /130–140/);
    assert.match(built.contextBlock, /SELECTED REGION/);
    assert.match(built.contextBlock, /ONION SKIN/);
    assert.match(built.contextBlock, /NEIGHBOR FRAMES/);
    assert.match(built.userMessage, /怪怪的/);
    assert.equal(isAskToolAllowed("analyze_selection"), true);
    assert.equal(isAskToolAllowed("repair_frame"), false);
    assert.equal(isAskToolAllowed("generate_inbetweens"), false);
    const formatted = ConversationContextBuilder.format(built);
    assert.match(formatted, /USER MESSAGE/);
  });

  it("fallback ASK reply follows the four-part workspace answer", () => {
    let ctx = createEmptyContext({ projectId: "proj", timelineId: "tl" });
    ctx = setCurrentFrame(ctx, { id: "f136", frameNumber: 136, timestampMs: 5666 });
    ctx = setSelectedRange(ctx, 135, 138, ctx.currentFrame);
    ctx = setSelectedRegion(ctx, {
      type: "rectangle",
      selectionType: "rectangle",
      frameId: "f136",
      frameNumber: 136,
      x: 0.4,
      y: 0.3,
      width: 0.2,
      height: 0.2,
    });
    const text = buildFallbackAskReply({
      ctx,
      analysisText: "MAE spike F135→F136",
      frameCount: 24,
    });
    assert.match(text, /目前在看 影格 136/);
    assert.match(text, /已選區域/);
    assert.match(text, /看起來不對勁的地方/);
    assert.match(text, /依據/);
    assert.match(text, /建議下一步（尚未執行）/);
    assert.match(text, /NOT_CONFIGURED/);
    assert.match(text, /ANALYZE_MOTION/);
  });

  it("parses suggestion JSON", () => {
    const actions = parseSuggestedActions(
      'hello\n{"type":"suggestion","action":"ANALYZE_MOTION","frame_range":[135,138]}\n',
      [135, 138],
    );
    assert.equal(actions[0]?.action, "ANALYZE_MOTION");
    const aliased = parseSuggestedActions(
      '{"type":"suggestion","action":"run_motion_analysis","frame_range":[135,138]}',
      [135, 138],
    );
    assert.equal(aliased[0]?.action, "ANALYZE_MOTION");
    assert.equal(isAskToolAllowed("get_selected_range"), true);
    assert.equal(isAskToolAllowed("get_frame"), false);
  });
});

describe("named spec builders", () => {
  it("VisionAssetBuilder and ProviderRegistry exist", () => {
    const vision = readFileSync(new URL("../src/lib/conversation/vision-assets.ts", import.meta.url), "utf8");
    const llm = readFileSync(new URL("../src/lib/ai/llm-provider.ts", import.meta.url), "utf8");
    assert.match(vision, /export const VisionAssetBuilder/);
    assert.match(llm, /export const ProviderRegistry/);
    assert.match(engineSrc, /export const ContextSerializer/);
    assert.match(engineSrc, /export const ContextResolver/);
  });
});

