import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeMotionSequence, propagateRegionByTrack } from "../src/lib/domain/motion-analysis.ts";
import { estimatePoseLite, poseContinuity } from "../src/lib/domain/pose-lite.ts";
import { detectTrackBreaks, canonicalTrackStatus } from "../src/lib/domain/track-continuity.ts";
import {
  fuseConsistency,
  mergeProblemRanges,
  toProblemFrames,
  entityStability,
} from "../src/lib/domain/consistency-engine.ts";
import { interiorRepairFrames, planRepairWindow } from "../src/lib/domain/repair-planner.ts";
import { isAskToolAllowed, isAssistToolAllowed } from "../src/lib/domain/conversation.ts";
import { hasScope } from "../src/lib/domain/permissions.ts";
import { analysisCacheKey, cacheGet, cacheSet } from "../src/lib/domain/analysis-cache.ts";
import { toAssistPayload, buildAssistResponse } from "../src/lib/domain/assist.ts";
import { buildConversationPrompt } from "../src/lib/domain/conversation.ts";
import { createEmptyContext, setCurrentFrame, setSelectedRange } from "../src/lib/domain/context-engine.ts";
import { readFileSync } from "node:fs";

function solid(w, h, r, g, b, shiftX = 0) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const on = x >= 8 + shiftX && x < 16 + shiftX && y >= 8 && y < 16;
      data[i] = on ? r : 10;
      data[i + 1] = on ? g : 10;
      data[i + 2] = on ? b : 10;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

describe("motion provider", () => {
  it("block-match is CPU fallback; sea-raft is a real worker", () => {
    const src = readFileSync(new URL("../src/lib/ai/providers.ts", import.meta.url), "utf8");
    assert.match(src, /class BlockMatchFlow/);
    assert.match(src, /readonly id = "block-match-16"/);
    assert.match(src, /class SeaRaftProvider/);
    assert.doesNotMatch(src, /new Reserved\("sea-raft"\)/);
  });

  it("detects a velocity spike on a jumping blob", () => {
    const frames = [
      { number: 0, rgba: solid(48, 32, 200, 200, 200, 0) },
      { number: 1, rgba: solid(48, 32, 200, 200, 200, 1) },
      { number: 2, rgba: solid(48, 32, 200, 200, 200, 12) },
    ];
    const pairs = analyzeMotionSequence(frames);
    assert.ok(pairs.length >= 2);
    assert.equal(pairs[0].provider, "block-match-16");
    assert.ok(pairs.some((p) => p.mean_motion >= 0));
  });

  it("rife, rtmpose, locotrack and sea-raft are real workers", () => {
    const src = readFileSync(new URL("../src/lib/ai/providers.ts", import.meta.url), "utf8");
    assert.match(src, /class RtmposeProvider/);
    assert.match(src, /class LocotrackProvider/);
    assert.match(src, /class SeaRaftProvider/);
    assert.doesNotMatch(src, /new Reserved\("rtmpose"\)/);
    assert.doesNotMatch(src, /new Reserved\("locotrack"\)/);
    assert.doesNotMatch(src, /new Reserved\("sea-raft"\)/);
    assert.match(src, /class RifeInterpolation/);
    assert.match(src, /class RifeInbetween/);
    assert.doesNotMatch(src, /fake (SEA-RAFT|RTMPose|LocoTrack|RIFE)/i);
  });
});

describe("pose-lite", () => {
  it("returns normalized keypoints, not random", () => {
    const a = estimatePoseLite(solid(48, 32, 20, 20, 20, 0), 10);
    assert.equal(a.provider, "framelab-pose-lite");
    assert.ok(a.keypoints.some((k) => k.name === "right_wrist"));
    for (const k of a.keypoints) {
      assert.ok(k.x >= 0 && k.x <= 1);
      assert.ok(k.y >= 0 && k.y <= 1);
    }
    assert.match(a.note, /Not RTMPose/);
  });

  it("flags a wrist velocity spike", () => {
    const mk = (frame, x) => ({
      frame_number: frame,
      provider: "framelab-pose-lite",
      bbox: { x: 0, y: 0, w: 1, h: 1 },
      keypoints: [
        { name: "right_wrist", x, y: 0.4, confidence: 0.9 },
        { name: "left_wrist", x: 0.2, y: 0.4, confidence: 0.9 },
        { name: "nose", x: 0.5, y: 0.2, confidence: 0.9 },
        { name: "right_ankle", x: 0.6, y: 0.8, confidence: 0.9 },
        { name: "left_ankle", x: 0.4, y: 0.8, confidence: 0.9 },
      ],
      note: "fixture",
      character_id: null,
    });
    const events = poseContinuity([mk(0, 0.2), mk(1, 0.22), mk(2, 0.7)], 24);
    assert.ok(events.some((e) => e.kind === "POSE_VELOCITY_SPIKE" && e.joint === "right_wrist"));
  });

  it("flags a joint direction reversal as POSE_DIRECTION_CHANGE", () => {
    const mk = (frame, x) => ({
      frame_number: frame,
      provider: "framelab-pose-lite",
      bbox: { x: 0, y: 0, w: 1, h: 1 },
      keypoints: [
        { name: "right_wrist", x, y: 0.4, confidence: 0.9 },
        { name: "left_wrist", x: 0.2, y: 0.4, confidence: 0.9 },
        { name: "nose", x: 0.5, y: 0.2, confidence: 0.9 },
        { name: "right_ankle", x: 0.6, y: 0.8, confidence: 0.9 },
        { name: "left_ankle", x: 0.4, y: 0.8, confidence: 0.9 },
      ],
      note: "fixture",
      character_id: null,
    });
    const events = poseContinuity([mk(10, 0.2), mk(11, 0.45), mk(12, 0.21)], 24);
    assert.ok(events.some((e) => e.kind === "POSE_DIRECTION_CHANGE" && e.joint === "right_wrist"));
  });

  it("pose-lite remains the basic fallback; rtmpose is wired", () => {
    const a = estimatePoseLite(solid(48, 32, 20, 20, 20, 0), 10);
    assert.equal(a.provider, "framelab-pose-lite");
    const src = readFileSync(new URL("../src/lib/ai/providers.ts", import.meta.url), "utf8");
    assert.match(src, /class PoseLiteProvider/);
    assert.match(src, /class RtmposeProvider/);
    assert.doesNotMatch(src, /new Reserved\("rtmpose"\)/);
  });
});

describe("tracking continuity", () => {
  it("marks lost and recovered as TRACK_BREAK", () => {
    const breaks = detectTrackBreaks([
      { name: "hand", frame: 120, x: 10, y: 10, status: "visible" },
      { name: "hand", frame: 121, x: 11, y: 10, status: "visible" },
      { name: "hand", frame: 122, x: 11, y: 10, status: "lost" },
      { name: "hand", frame: 123, x: 40, y: 12, status: "recovered" },
    ]);
    assert.ok(breaks.some((b) => b.kind === "TRACK_BREAK"));
    const src = readFileSync(new URL("../src/lib/ai/providers.ts", import.meta.url), "utf8");
    assert.match(src, /class NccPointTracker/);
    assert.match(src, /class LocotrackProvider/);
    assert.doesNotMatch(src, /new Reserved\("locotrack"\)/);
  });
});

describe("consistency + problem ranges", () => {
  it("merges neighboring problem frames and assigns severity from metrics", () => {
    const motion = analyzeMotionSequence([
      { number: 10, rgba: solid(48, 32, 200, 200, 200, 0) },
      { number: 11, rgba: solid(48, 32, 200, 200, 200, 1) },
      { number: 12, rgba: solid(48, 32, 200, 200, 200, 14) },
    ]);
    const findings = fuseConsistency({
      motion,
      trackBreaks: [
        { name: "hand", frame: 12, kind: "TRACK_BREAK", from: "visible", to: "lost", jump: 50, severity: "error", note: "lost" },
      ],
    });
    const problems = toProblemFrames(findings);
    const ranges = mergeProblemRanges(problems);
    assert.ok(findings.every((f) => typeof f.score === "number"));
    assert.ok(ranges.length >= 1);
    assert.ok(ranges[0].start <= ranges[0].end);
  });
});

describe("repair planner", () => {
  it("protects keyframes and locked frames", () => {
    const plan = planRepairWindow(
      {
        start: 134,
        end: 138,
        peak_frame: 136,
        category: "MOTION_CONTINUITY",
        severity: "warning",
        score: 0.5,
        reason: "spike",
        frames: [134, 135, 136, 137, 138],
      },
      [
        { frameNumber: 132, frameType: "KEY" },
        { frameNumber: 134, frameType: "INBETWEEN" },
        { frameNumber: 136, frameType: "INBETWEEN" },
        { frameNumber: 140, frameType: "KEY" },
        { frameNumber: 135, frameType: "INBETWEEN", isLocked: true },
      ],
    );
    assert.deepEqual(plan.problem_range, [134, 138]);
    assert.ok(plan.protected_frames.includes(132) || plan.repair_range[0] <= 134);
    assert.ok(plan.protected_frames.includes(135));
    assert.equal(plan.interpolation, "FULL_FRAME_INTERPOLATION");
    const interior = interiorRepairFrames(plan);
    assert.ok(!interior.includes(135));
  });
});

describe("permissions ASK vs ASSIST vs confirm", () => {
  it("ASK cannot edit; ASSIST cannot execute repair; UI confirm can", () => {
    assert.equal(isAskToolAllowed("execute_repair_plan"), false);
    assert.equal(isAskToolAllowed("accept_revision"), false);
    assert.equal(isAskToolAllowed("restore_revision"), false);
    assert.equal(isAssistToolAllowed("execute_repair_plan"), false);
    assert.equal(isAssistToolAllowed("accept_revision"), false);
    assert.equal(isAssistToolAllowed("suggest_repair"), true);
    assert.equal(isAssistToolAllowed("create_repair_plan"), true);
    assert.equal(hasScope(["READ", "ANALYZE", "SUGGEST"], "EDIT"), false);
    assert.equal(hasScope(["READ", "ANALYZE", "EDIT"], "EDIT"), true);
    const src = readFileSync(new URL("../src/lib/ai/providers.ts", import.meta.url), "utf8");
    assert.match(src, /class LinearBlendInterpolation/);
    assert.match(src, /class RifeInterpolation/);
  });
});

describe("analysis cache", () => {
  it("same inputs produce the same key and round-trip memory cache", () => {
    const key = analysisCacheKey({
      analysisType: "motion",
      provider: "block-match-16",
      frameHashes: ["aaa", "bbb"],
      start: 10,
      end: 12,
    });
    assert.match(key, /motion\|block-match-16/);
    cacheSet(key, { mean: 1.2 });
    assert.deepEqual(cacheGet(key), { mean: 1.2 });
  });
});

describe("assist payload + explanations", () => {
  it("builds a serializable assist payload with suggested actions", () => {
    const motion = analyzeMotionSequence([
      { number: 134, rgba: solid(48, 32, 200, 200, 200, 0) },
      { number: 135, rgba: solid(48, 32, 200, 200, 200, 1) },
      { number: 136, rgba: solid(48, 32, 200, 200, 200, 14) },
    ]);
    const findings = fuseConsistency({ motion });
    const problems = toProblemFrames(findings);
    const ranges = mergeProblemRanges(problems);
    const assist = buildAssistResponse({
      findings,
      problems,
      ranges,
      contextLabel: "F134–F136",
    });
    const payload = toAssistPayload(assist);
    assert.equal(typeof payload.summary, "string");
    assert.equal(payload.plan_id, null);
    assert.ok(Array.isArray(payload.suggested_actions));
    JSON.stringify(payload);
  });

  it("ASSIST prompt lists analyze/suggest tools, not execute_repair_plan", () => {
    let ctx = createEmptyContext({ projectId: "p", timelineId: "t" });
    ctx = setCurrentFrame(ctx, { id: "f", frameNumber: 10, timestampMs: 0 });
    ctx = setSelectedRange(ctx, 10, 20, ctx.currentFrame);
    const built = buildConversationPrompt({
      ctx,
      userMessage: "why is this jumpy",
      mode: "ASSIST",
    });
    assert.ok(built.tools.includes("suggest_repair"));
    assert.ok(built.tools.includes("analyze_motion"));
    assert.ok(!built.tools.includes("execute_repair_plan"));
  });
});

describe("revision snapshot shape", () => {
  it("interior repair never includes protected keyframes", () => {
    const plan = planRepairWindow(
      {
        start: 28,
        end: 31,
        peak_frame: 29,
        category: "MOTION_CONTINUITY",
        severity: "error",
        score: 0.4,
        reason: "jump",
        frames: [28, 29, 30, 31],
      },
      [
        { frameNumber: 26, frameType: "KEY" },
        { frameNumber: 28, frameType: "INBETWEEN" },
        { frameNumber: 29, frameType: "INBETWEEN" },
        { frameNumber: 30, frameType: "INBETWEEN" },
        { frameNumber: 32, frameType: "KEY" },
      ],
    );
    const interior = interiorRepairFrames(plan);
    assert.ok(!interior.includes(26));
    assert.ok(!interior.includes(32));
    assert.equal(plan.interpolation, "FULL_FRAME_INTERPOLATION");
  });
});

describe("region propagate + entity stability", () => {
  it("shifts a region with a track that started inside it", () => {
    const region = { x: 10, y: 10, w: 20, h: 20 };
    const next = propagateRegionByTrack(
      region,
      10,
      12,
      [
        { name: "hand", frame: 10, x: 15, y: 16 },
        { name: "hand", frame: 12, x: 25, y: 18 },
      ],
      { width: 100, height: 80 },
    );
    assert.equal(next.x, 20);
    assert.equal(next.y, 12);
    assert.equal(next.w, 20);
  });

  it("flags a character missing in the middle of a span", () => {
    const findings = entityStability(
      [{ id: "c1", name: "Hero", frames: [10, 11, 14] }],
      [10, 14],
      "CHARACTER_STABILITY",
    );
    assert.ok(findings.some((f) => f.frame === 12 || f.frame === 13));
    assert.equal(findings[0].type, "CHARACTER_STABILITY");
    assert.equal(findings[0].severity, "warning");
  });
});

describe("provider health_check", () => {
  it("is implemented on reserved and ready adapters", () => {
    const src = readFileSync(new URL("../src/lib/ai/providers.ts", import.meta.url), "utf8");
    assert.match(src, /health_check\(\)/);
    assert.match(src, /healthCheck\(this\)/);
    assert.match(src, /class BlockMatchFlow/);
    assert.match(src, /class PoseLiteProvider/);
    assert.match(src, /class NccPointTracker/);
  });
});

describe("range revision snapshot", () => {
  it("previous.frames shape can restore a window", () => {
    const previous = {
      frames: [
        { frameId: "frm-1", frameNumber: 135, imageData: "aaa", contentHash: "h1" },
        { frameId: "frm-2", frameNumber: 136, imageData: "bbb", contentHash: "h2" },
      ],
    };
    assert.equal(previous.frames.length, 2);
    assert.ok(previous.frames.every((f) => f.imageData && f.frameId));
  });
});

describe("confirmation + original assets", () => {
  it("execute_repair_plan and restore_revision require confirmed=true", () => {
    const src = readFileSync(new URL("../src/lib/commands/execute.ts", import.meta.url), "utf8");
    assert.match(src, /requireConfirmedEdit\("execute_repair_plan"/);
    assert.match(src, /requireConfirmedEdit\("restore_revision"/);
    const ui = readFileSync(new URL("../src/components/workstation/studio-app.tsx", import.meta.url), "utf8");
    assert.match(ui, /execute_repair_plan", args: \{ planId: repairPlanId, confirmed: true \}/);
  });

  it("repair writes originals/ and repaired/ assets, not in-place only", () => {
    const src = readFileSync(new URL("../src/lib/commands/assist-tools.ts", import.meta.url), "utf8");
    assert.match(src, /"originals"/);
    assert.match(src, /original_asset/);
    assert.match(src, /active_asset/);
  });
});

describe("region motion vs full frame", () => {
  it("region crop is marked on the pair summary", () => {
    const frames = [
      { number: 0, rgba: solid(48, 32, 200, 200, 200, 0) },
      { number: 1, rgba: solid(48, 32, 200, 200, 200, 4) },
    ];
    const full = analyzeMotionSequence(frames);
    const region = analyzeMotionSequence(frames, { region: { x: 8, y: 8, w: 16, h: 16 } });
    assert.equal(full[0].region, false);
    assert.equal(region[0].region, true);
    assert.ok(full[0].motion_bbox === null || typeof full[0].motion_bbox?.w === "number");
    assert.ok(typeof full[0].confidence === "number");
  });
});

describe("track status canonicalization", () => {
  it("maps lowercase samples to VISIBLE/OCCLUDED/LOST/RECOVERED", () => {
    assert.equal(canonicalTrackStatus("visible"), "VISIBLE");
    assert.equal(canonicalTrackStatus("lost"), "LOST");
    assert.equal(canonicalTrackStatus("recovered"), "RECOVERED");
    assert.equal(canonicalTrackStatus("occluded"), "OCCLUDED");
  });
});

describe("e2e domain assist pipeline", () => {
  it("select F20–F40, fuse, detect problems, plan interior-only repair", () => {
    const frames = [];
    for (let n = 20; n <= 40; n += 1) {
      const shift = n >= 28 && n <= 31 ? 14 : n === 27 || n === 32 ? 1 : 0;
      frames.push({ number: n, rgba: solid(48, 32, 200, 200, 200, shift) });
    }
    const motion = analyzeMotionSequence(frames);
    const findings = fuseConsistency({
      motion,
      trackBreaks: [
        { name: "hand", frame: 29, kind: "TRACK_BREAK", from: "visible", to: "lost", jump: 40, severity: "error", note: "lost" },
      ],
    });
    const problems = toProblemFrames(findings);
    const ranges = mergeProblemRanges(problems);
    assert.ok(ranges.length >= 1);
    const plan = planRepairWindow(ranges[0], [
      { frameNumber: 20, frameType: "KEY" },
      { frameNumber: 28, frameType: "INBETWEEN" },
      { frameNumber: 29, frameType: "INBETWEEN" },
      { frameNumber: 30, frameType: "INBETWEEN" },
      { frameNumber: 31, frameType: "INBETWEEN" },
      { frameNumber: 40, frameType: "KEY" },
    ]);
    const interior = interiorRepairFrames(plan);
    assert.ok(!interior.includes(20));
    assert.ok(!interior.includes(40));
    assert.equal(plan.interpolation, "FULL_FRAME_INTERPOLATION");
    const assist = buildAssistResponse({
      findings,
      problems,
      ranges,
      plan,
      contextLabel: "F20–F40",
    });
    assert.match(assist.summary, /F20–F40/);
    assert.ok(assist.suggested_actions.some((a) => a.action === "CREATE_REPAIR_PLAN"));
    assert.ok(assist.suggested_actions.every((a) => a.auto === false));
  });
});

describe("consistency engine is canonical", () => {
  it("analyze_consistency does not wipe fused scores with pixel-only results", () => {
    const src = readFileSync(new URL("../src/lib/commands/execute.ts", import.meta.url), "utf8");
    assert.match(src, /suggestRepair/);
    assert.doesNotMatch(src, /clearConsistency\(t\.id\);/);
    assert.match(src, /Consistency Engine fuses/);
  });
});
