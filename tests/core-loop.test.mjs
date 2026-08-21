import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTimelineState,
  onionNeighbors,
  seek,
  selectRange,
  setOnionSkin,
} from "../src/lib/domain/timeline-engine.ts";
import {
  ContextResolver,
  createEmptyContext,
  effectiveContext,
  isStaleContext,
  lockContext,
  paddedNormalizedRegion,
  resolveAskContext,
  resolveFocus,
  serializeContext,
  setCurrentFrame,
  setSelectedRange,
  setSelectedRegion,
} from "../src/lib/domain/context-engine.ts";
import {
  comparePair,
  LIGHTWEIGHT_KIND,
  summarizeObservations,
} from "../src/lib/domain/lightweight-analysis.ts";
import {
  buildConversationPrompt,
  isAskToolAllowed,
  parseSuggestedActions,
} from "../src/lib/domain/conversation.ts";

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

describe("V0.1 core loop smoke (§60)", () => {
  it("video frames → timeline → onion → range → region → context → analysis → ASK prompt", () => {
    let timeline = createTimelineState({ fps: 24, frameCount: 24 });
    timeline = seek(timeline, 10);
    assert.equal(timeline.currentFrame, 10);
    assert.equal(timeline.selectedRange, null);

    timeline = setOnionSkin(timeline, { enabled: true, prev: 2, next: 2 });
    const onion = onionNeighbors(10, 24, timeline.onionSkin);
    assert.deepEqual(onion.prev, [8, 9]);
    assert.deepEqual(onion.next, [11, 12]);

    timeline = selectRange(timeline, 8, 12);
    assert.deepEqual(timeline.selectedRange, [8, 12]);

    let ctx = createEmptyContext({
      projectId: "proj",
      videoId: "vid",
      timelineId: "tl",
      currentFrame: { id: "f10", frameNumber: 10, timestampMs: 416 },
      selectedRange: { startFrame: 8, endFrame: 12 },
      selectedFrames: [8, 9, 10, 11, 12],
      onionSkin: {
        enabled: true,
        previousFrames: 2,
        nextFrames: 2,
        previousOpacity: 0.35,
        nextOpacity: 0.28,
      },
    });
    ctx = setSelectedRegion(ctx, {
      type: "rectangle",
      selectionType: "rectangle",
      frameId: "f10",
      frameNumber: 10,
      x: 0.42,
      y: 0.31,
      width: 0.18,
      height: 0.24,
    });

    const snap = serializeContext(ctx);
    assert.equal(snap.current_frame, 10);
    assert.deepEqual(snap.selected_range, [8, 12]);
    assert.ok(snap.selected_region);
    assert.equal(snap.neighbors_available, true);
    assert.equal(resolveFocus(ctx), "selected_region");

    const ask = resolveAskContext(ctx, 24);
    assert.equal(ask.focus, "selected_region");
    assert.deepEqual(ask.range, [8, 12]);
    assert.ok(ask.neighbors.includes(10));
    assert.match(ask.summary, /region selected/);

    const frames = {
      8: solid(16, 16, 10, 10, 10),
      9: solid(16, 16, 12, 12, 12),
      10: solid(16, 16, 14, 14, 14),
      11: solid(16, 16, 180, 20, 20),
      12: solid(16, 16, 16, 16, 16),
    };
    const observations = [];
    for (const [a, b] of [
      [8, 9],
      [9, 10],
      [10, 11],
      [11, 12],
    ]) {
      observations.push(...comparePair(frames[a], frames[b], a, b));
    }
    const report = summarizeObservations(observations, [8, 9, 10, 11, 12], true);
    assert.equal(report.kind, LIGHTWEIGHT_KIND);
    assert.match(report.summary, /selected region|F8|F10/);
    assert.ok(report.limitations.some((l) => /pose/i.test(l)));
    const spike = report.observations
      .filter((o) => o.kind === "mae")
      .sort((x, y) => y.value - x.value)[0];
    assert.ok(spike);
    assert.deepEqual(spike.frames, [10, 11]);

    const built = buildConversationPrompt({
      ctx,
      userMessage: "What looks inconsistent here?",
      analysisText: `${report.kind}\n${report.summary}`,
      fps: 24,
      frameCount: 24,
    });
    assert.match(built.contextBlock, /CURRENT PROJECT/);
    assert.match(built.contextBlock, /SELECTED RANGE/);
    assert.match(built.contextBlock, /8–12/);
    assert.match(built.contextBlock, /SELECTED REGION/);
    assert.match(built.contextBlock, /NEIGHBOR FRAMES/);
    assert.match(built.userMessage, /inconsistent here/);
    assert.equal(isAskToolAllowed("get_current_context"), true);
    assert.equal(isAskToolAllowed("get_frame_neighbors"), true);
    assert.equal(isAskToolAllowed("get_selected_range"), true);
    assert.equal(isAskToolAllowed("analyze_selection"), true);
    assert.equal(isAskToolAllowed("repair_frame"), false);
    assert.equal(isAskToolAllowed("generate_inbetweens"), false);

    const padded = paddedNormalizedRegion(ctx.selectedRegion, 0.15);
    assert.ok(padded.width > ctx.selectedRegion.width);

    const lock = lockContext(ctx);
    const later = setCurrentFrame(ctx, { id: "f20", frameNumber: 20, timestampMs: 0 });
    const frozen = effectiveContext(later, lock);
    assert.equal(frozen.currentFrame.frameNumber, 10);
    assert.equal(ContextResolver.isStale(14, 20, { locked: false, snapshot: null }), true);
    assert.equal(isStaleContext(14, 20, lock), false);

    const suggestions = parseSuggestedActions(
      '{"type":"suggestion","action":"ANALYZE_MOTION","frame_range":[8,12]}',
      [8, 12],
    );
    assert.equal(suggestions[0]?.action, "ANALYZE_MOTION");
  });

  it("clicking a frame after a range select is single-frame (seek clears range)", () => {
    let s = createTimelineState({ frameCount: 24, currentFrame: 10 });
    s = selectRange(s, 8, 12);
    assert.deepEqual(s.selectedRange, [8, 12]);
    s = seek(s, 10);
    assert.equal(s.currentFrame, 10);
    assert.equal(s.selectedRange, null);
    assert.deepEqual(s.selectedFrames, [10]);
  });
});
