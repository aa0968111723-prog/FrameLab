import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { FrameLabError } from "../src/lib/domain/errors.ts";
import { validateKeyframePair, generatedFrameNumbers } from "../src/lib/domain/keyframe-pair.ts";
import { buildMotionPlan, nextPlanVersion, hashMotionPlan, motionProgressForFrame } from "../src/lib/domain/motion-plan.ts";
import { sampleCurve, applyCurve } from "../src/lib/domain/motion-curve.ts";
import { blendRgba } from "../src/lib/domain/pixel-metrics.ts";
import { scoreTransition, midpointBreakdown } from "../src/lib/domain/transition-analysis.ts";
import { resolveInbetweenStrategy, linearBlendCapabilities } from "../src/lib/domain/inbetween-strategy.ts";
import {
  constraintWarnings,
  contactFromPair,
  CONSTRAINT_KINDS,
} from "../src/lib/domain/animation-constraints.ts";
import { parseAnimationIntent, isInbetweenRequest, isCurveAdjustRequest } from "../src/lib/domain/animation-intent.ts";
import { betweenEdges } from "../src/lib/domain/frame-graph.ts";
import { resolveGenerationSize, downscaleRgba } from "../src/lib/domain/generation-resolution.ts";
import { planMinimalRegeneration, assertNotProtected } from "../src/lib/domain/regeneration-planner.ts";
import { generationCacheKey, generationCacheGet, generationCacheSet } from "../src/lib/domain/generation-cache.ts";
import { isAskToolAllowed, isAssistToolAllowed } from "../src/lib/domain/conversation.ts";
import { assertToolAllowed, hasScope, requireConfirmedEdit, TOOL_SCOPES } from "../src/lib/domain/permissions.ts";
import { MCP_TOOLS, MCP_RESOURCE_TEMPLATES } from "../src/lib/mcp/catalog.ts";
import { mapRestPath } from "../src/lib/framelab/rest-map.ts";
import { encodePng } from "../src/lib/domain/image-codec.ts";

function solid(w, h, r, g, b, shiftX = 0) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const on = x >= 6 + shiftX && x < 14 + shiftX && y >= 6 && y < 14;
      data[i] = on ? r : 8;
      data[i + 1] = on ? g : 8;
      data[i + 2] = on ? b : 8;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

describe("keyframe pair", () => {
  it("valid pair computes gap and inbetween count", () => {
    const p = validateKeyframePair({
      timelineId: "t",
      startFrame: 100,
      endFrame: 110,
      startExists: true,
      endExists: true,
      startHasAsset: true,
      endHasAsset: true,
    });
    assert.equal(p.frame_gap, 10);
    assert.equal(p.desired_inbetween_count, 9);
    assert.equal(p.status, "ready");
    assert.deepEqual(generatedFrameNumbers(100, 9), [101, 102, 103, 104, 105, 106, 107, 108, 109]);
  });

  it("rejects same frame", () => {
    assert.throws(
      () => validateKeyframePair({ timelineId: "t", startFrame: 5, endFrame: 5 }),
      (err) => err instanceof FrameLabError && err.code === "INVALID_KEYFRAME_PAIR",
    );
  });

  it("rejects missing start", () => {
    assert.throws(
      () =>
        validateKeyframePair({
          timelineId: "t",
          startFrame: 1,
          endFrame: 4,
          startExists: false,
          endExists: true,
        }),
      (err) => err instanceof FrameLabError && err.code === "KEYFRAME_NOT_FOUND",
    );
  });

  it("rejects missing asset", () => {
    assert.throws(
      () =>
        validateKeyframePair({
          timelineId: "t",
          startFrame: 1,
          endFrame: 4,
          startExists: true,
          endExists: true,
          startHasAsset: false,
          endHasAsset: true,
        }),
      (err) => err instanceof FrameLabError && err.code === "FRAME_ASSET_UNAVAILABLE",
    );
  });

  it("rejects locked invalid state", () => {
    assert.throws(
      () =>
        validateKeyframePair({
          timelineId: "t",
          startFrame: 1,
          endFrame: 4,
          startExists: true,
          endExists: true,
          startHasAsset: true,
          endHasAsset: true,
          startLockedInvalid: true,
        }),
      (err) => err instanceof FrameLabError && err.code === "INVALID_KEYFRAME_PAIR",
    );
  });
});

describe("motion plan", () => {
  it("ease-in-out spacing differs from linear", () => {
    const linear = sampleCurve(9, "linear");
    const ease = sampleCurve(9, "ease_in_out");
    assert.equal(linear.length, 9);
    assert.ok(ease[0] < linear[0]);
    assert.ok(ease[8] > linear[8]);
    const plan = buildMotionPlan({ start: 100, end: 110, count: 9, curve: "ease_in_out" });
    assert.equal(plan.timing.frames, 9);
    assert.equal(plan.spacing.length, 9);
    assert.ok(motionProgressForFrame(plan, 0) > 0);
    assert.ok(motionProgressForFrame(plan, 0) < 1);
  });

  it("hold spacing stays at the start pose", () => {
    const hold = sampleCurve(5, "hold");
    assert.ok(hold.every((t) => t === 0));
    assert.equal(applyCurve(1, "hold"), 1);
  });

  it("versions instead of overwriting", () => {
    const v1 = buildMotionPlan({ start: 100, end: 110, count: 9, curve: "linear" });
    const v2 = nextPlanVersion(v1, { curve: "ease_in_out" });
    assert.equal(v1.version, 1);
    assert.equal(v2.version, 2);
    assert.equal(v1.curve, "linear");
    assert.equal(v2.curve, "ease_in_out");
    assert.notEqual(hashMotionPlan(v1), hashMotionPlan(v2));
  });

  it("serializes constraints and contact", () => {
    const contact = contactFromPair("xiaohua", "right_hand", "suitcase", 100, 110);
    const plan = buildMotionPlan({
      start: 100,
      end: 110,
      count: 9,
      constraints: [contact, { kind: "PRESERVE_FACE" }],
    });
    const json = JSON.stringify(plan);
    const back = JSON.parse(json);
    assert.equal(back.constraints[0].kind, "MAINTAIN_CONTACT");
    assert.equal(back.constraints[0].source_point, "right_hand");
    assert.ok(CONSTRAINT_KINDS.includes("LOCK_KEYFRAME"));
  });
});

describe("provider routing", () => {
  it("low movement uses interpolation", () => {
    const a = scoreTransition({
      mean_motion: 1.2,
      pose_displacement: 0.05,
      object_displacement: 0,
      visual_similarity: 0.92,
      character_count: 1,
      contact_count: 0,
      camera_motion: 0,
      occlusion: false,
    });
    assert.equal(a.complexity, "LOW");
    const s = resolveInbetweenStrategy({
      complexity: a.complexity,
      interpolationAvailable: true,
      generativeAvailable: false,
    });
    assert.equal(s.kind, "interpolation");
    assert.equal(s.provider, "rife");
  });

  it("large pose suggests breakdown", () => {
    const a = scoreTransition({
      mean_motion: 20,
      pose_displacement: 0.9,
      object_displacement: 0.5,
      visual_similarity: 0.2,
      character_count: 2,
      contact_count: 1,
      camera_motion: 3,
      occlusion: true,
    });
    assert.equal(a.complexity, "VERY_HIGH");
    assert.equal(a.suggest_breakdown, true);
    assert.equal(midpointBreakdown(100, 110), 105);
    const s = resolveInbetweenStrategy({
      complexity: "VERY_HIGH",
      interpolationAvailable: true,
      generativeAvailable: false,
    });
    assert.equal(s.kind, "suggest_breakdown");
  });

  it("HIGH without generative falls back to RIFE", () => {
    const s = resolveInbetweenStrategy({
      complexity: "HIGH",
      interpolationAvailable: true,
      generativeAvailable: false,
    });
    assert.equal(s.kind, "interpolation");
    assert.match(s.reason, /MODEL_NOT_AVAILABLE/);
  });

  it("wan / fal / comfyui are unavailable; rife is a real worker; linear-blend is 快速預覽", () => {
    const src = readFileSync(new URL("../src/lib/ai/providers.ts", import.meta.url), "utf8");
    assert.match(src, /class WanInbetween/);
    assert.match(src, /class FalInbetween/);
    assert.match(src, /class ComfyInbetween/);
    assert.match(src, /class RifeInbetween/);
    assert.match(src, /PROVIDER_NOT_AVAILABLE/);
    assert.doesNotMatch(src, /TEST_ONLY/);
    assert.doesNotMatch(src, /random image|solid color fake/i);
    assert.match(src, /快速預覽/);
  });

  it("capability mismatch warns instead of pretending to enforce", () => {
    const caps = linearBlendCapabilities();
    const warnings = constraintWarnings(
      [
        { kind: "PRESERVE_FACE" },
        { kind: "PRESERVE_BACKGROUND" },
        { kind: "MAINTAIN_CONTACT" },
        { kind: "LOCK_KEYFRAME" },
      ],
      caps,
    );
    assert.ok(warnings.some((w) => w.constraint === "PRESERVE_FACE"));
    assert.ok(warnings.some((w) => w.constraint === "MAINTAIN_CONTACT"));
    assert.ok(!warnings.some((w) => w.constraint === "LOCK_KEYFRAME"));
    assert.match(warnings[0].message, /無法強制|僅評估/);
  });

  it("does not copy pixel mean_motion as camera_motion", () => {
    const src = readFileSync(new URL("../src/lib/commands/inbetween-tools.ts", import.meta.url), "utf8");
    assert.match(src, /camera_motion: 0/);
    assert.doesNotMatch(src, /camera_motion: motion\[0\]\?\.mean_motion/);
    assert.match(src, /promoteKeys === true/);
    assert.match(src, /imageData: f\.imageData/);
  });
});

describe("interpolation provider", () => {
  it("linear-blend actually blends two frames along the curve", () => {
    const a = solid(32, 24, 200, 40, 40, 0);
    const b = solid(32, 24, 40, 40, 200, 10);
    const t = applyCurve(0.5, "linear");
    const mid = blendRgba(a, b, t);
    const i = (8 * 32 + 11) * 4;
    assert.ok(mid.data[i] !== a.data[i] || mid.data[i + 2] !== a.data[i + 2]);
    const hold = blendRgba(a, b, applyCurve(0.5, "hold"));
    assert.equal(hold.data[i], a.data[i]);
  });
});

describe("generation cache", () => {
  it("misses when curve, seed, constraint, or count change", () => {
    const base = {
      startHash: "aaa",
      endHash: "bbb",
      provider: "linear-blend",
      modelVersion: "0.3",
      seed: null,
      motionPlanHash: "mp1",
      constraintHash: "PRESERVE_FACE",
      resolution: "preview",
      frameCount: 9,
    };
    const k1 = generationCacheKey(base);
    const k2 = generationCacheKey({ ...base, motionPlanHash: "mp2" });
    const k3 = generationCacheKey({ ...base, seed: 7 });
    const k4 = generationCacheKey({ ...base, constraintHash: "PRESERVE_FACE,MAINTAIN_CONTACT" });
    const k5 = generationCacheKey({ ...base, frameCount: 8 });
    const k6 = generationCacheKey({ ...base, resolution: "production" });
    assert.notEqual(k1, k2);
    assert.notEqual(k1, k3);
    assert.notEqual(k1, k4);
    assert.notEqual(k1, k5);
    assert.notEqual(k1, k6);
    generationCacheSet(k1, { frames: 9 });
    assert.deepEqual(generationCacheGet(k1), { frames: 9 });
    assert.equal(generationCacheGet(k2), null);
  });
});

describe("minimal regeneration", () => {
  it("only plans the bad interior, never keys", () => {
    const plan = planMinimalRegeneration(
      [
        { frame: 105, category: "HAND_CONTACT_BREAK", severity: "error" },
        { frame: 106, category: "HAND_CONTACT_BREAK", severity: "error" },
      ],
      [
        { frameNumber: 100, frameType: "KEY" },
        { frameNumber: 101, frameType: "GENERATED" },
        { frameNumber: 102, frameType: "GENERATED" },
        { frameNumber: 103, frameType: "GENERATED" },
        { frameNumber: 104, frameType: "GENERATED" },
        { frameNumber: 105, frameType: "GENERATED" },
        { frameNumber: 106, frameType: "GENERATED" },
        { frameNumber: 107, frameType: "GENERATED" },
        { frameNumber: 108, frameType: "GENERATED" },
        { frameNumber: 109, frameType: "GENERATED" },
        { frameNumber: 110, frameType: "KEY" },
      ],
      [100, 110],
    );
    assert.ok(plan);
    assert.deepEqual(plan.problem_range, [105, 106]);
    assert.ok(plan.regenerate_range[0] >= 105);
    assert.ok(plan.regenerate_range[1] <= 106 || plan.regenerate_range[1] === 106);
    assert.ok(plan.protected_frames.includes(100) || plan.boundary_start >= 100);
    assert.equal(assertNotProtected(100, [{ frameNumber: 100, frameType: "KEY" }]), false);
    assert.equal(assertNotProtected(105, [{ frameNumber: 105, frameType: "GENERATED" }]), true);
    assert.equal(assertNotProtected(102, [{ frameNumber: 102, isLocked: true }]), false);
  });

  it("does not default to regenerating the whole span", () => {
    const plan = planMinimalRegeneration(
      [{ frame: 105, category: "POSE_CONTINUITY", severity: "warning" }],
      Array.from({ length: 11 }, (_, i) => ({
        frameNumber: 100 + i,
        frameType: i === 0 || i === 10 ? "KEY" : "GENERATED",
      })),
      [100, 110],
    );
    assert.ok(plan);
    const [a, b] = plan.regenerate_range;
    assert.ok(b - a < 9);
  });
});

describe("animation intent", () => {
  it("parses count, curve, and contact from Chinese", () => {
    const intent = parseAnimationIntent(
      "帮我把 F100 到 F110 中间补 9 帧。动作柔和一点，小华的右手一定要一直抓着行李箱，脸和背景不要乱变。",
      { start: 100, end: 110 },
    );
    assert.equal(intent.count, 9);
    assert.equal(intent.curve, "ease_in_out");
    assert.ok(intent.constraints.some((c) => c.kind === "PRESERVE_FACE"));
    assert.ok(intent.constraints.some((c) => c.kind === "PRESERVE_BACKGROUND"));
    assert.ok(intent.constraints.some((c) => c.kind === "MAINTAIN_CONTACT"));
    assert.equal(isInbetweenRequest("幫我把這兩張中間補 9 幀。"), true);
    assert.equal(isInbetweenRequest("why is this jumpy"), false);
    assert.equal(isCurveAdjustRequest("這段太機械了，柔和一點。"), true);
    assert.equal(isCurveAdjustRequest("幫我補 9 幀，柔和一點"), false);
    const tw = parseAnimationIntent(
      "幫我把這兩張中間補9幀。動作柔和一點，小華的右手一定要一直抓著行李箱，臉和背景不要亂變。",
      { start: 100, end: 110 },
    );
    assert.equal(tw.count, 9);
    assert.equal(tw.curve, "ease_in_out");
    assert.ok(tw.constraints.some((c) => c.kind === "PRESERVE_FACE"));
    assert.ok(tw.constraints.some((c) => c.kind === "PRESERVE_BACKGROUND"));
    assert.ok(tw.constraints.some((c) => c.kind === "MAINTAIN_CONTACT"));
    assert.equal(tw.start_frame, 100);
    assert.equal(tw.end_frame, 110);
  });
});

describe("permissions", () => {
  it("READ / ANALYZE / SUGGEST cannot generate; GENERATE can; EDIT required to accept", () => {
    assert.equal(TOOL_SCOPES.generate_inbetweens, "GENERATE");
    assert.equal(TOOL_SCOPES.accept_generated_frames, "EDIT");
    assert.equal(TOOL_SCOPES.create_inbetween_plan, "SUGGEST");
    assert.equal(hasScope(["READ"], "GENERATE"), false);
    assert.equal(hasScope(["ANALYZE"], "GENERATE"), false);
    assert.equal(hasScope(["SUGGEST"], "GENERATE"), false);
    assert.equal(hasScope(["GENERATE"], "GENERATE"), true);
    assert.equal(hasScope(["GENERATE"], "EDIT"), false);
    assert.equal(hasScope(["EDIT"], "EDIT"), true);
    assert.throws(() => assertToolAllowed(["READ"], "generate_inbetweens"), FrameLabError);
    assert.throws(() => assertToolAllowed(["GENERATE"], "accept_generated_frames"), FrameLabError);
    assert.doesNotThrow(() => assertToolAllowed(["GENERATE"], "generate_inbetweens"));
    assert.doesNotThrow(() => assertToolAllowed(["EDIT"], "accept_generated_frames"));
    assert.equal(isAskToolAllowed("generate_inbetweens"), false);
    assert.equal(isAssistToolAllowed("generate_inbetweens"), false);
    assert.equal(isAssistToolAllowed("create_inbetween_plan"), true);
    assert.equal(isAskToolAllowed("accept_generated_frames"), false);
  });

  it("generate requires confirmed=true", () => {
    assert.throws(
      () => requireConfirmedEdit("generate_inbetweens", {}),
      (err) => err instanceof FrameLabError && err.code === "PERMISSION_DENIED",
    );
    assert.doesNotThrow(() => requireConfirmedEdit("generate_inbetweens", { confirmed: true }));
  });
});

describe("mcp / rest surface", () => {
  it("exposes V0.3 tools and resources", () => {
    const names = new Set(MCP_TOOLS.map((t) => t.name));
    for (const t of [
      "create_keyframe_pair",
      "analyze_keyframe_transition",
      "create_motion_plan",
      "suggest_breakdown_frames",
      "create_inbetween_plan",
      "generate_inbetweens",
      "get_generation_job",
      "evaluate_inbetweens",
      "regenerate_inbetween_range",
      "accept_generated_frames",
      "reject_generated_frames",
      "get_candidate",
      "generate_breakdown_frame",
      "set_frame_exposure",
      "set_playback_fps",
    ]) {
      assert.ok(names.has(t), t);
    }
    const templates = MCP_RESOURCE_TEMPLATES.map((t) => t.uriTemplate);
    assert.ok(templates.includes("framelab://keyframe-pairs/{id}"));
    assert.ok(templates.includes("framelab://motion-plans/{id}"));
    assert.ok(templates.includes("framelab://candidates/{id}"));
    assert.equal(mapRestPath("POST", "/api/v1/inbetweens/generate", {})?.tool, "generate_inbetweens");
    assert.equal(mapRestPath("POST", "/api/v1/keyframe-pairs/p1/analyze", {})?.args.pairId, "p1");
    assert.equal(mapRestPath("POST", "/api/v1/inbetweens/abc/accept", {})?.tool, "accept_generated_frames");
    assert.equal(mapRestPath("POST", "/api/v1/export/sequence", {})?.tool, "export_frame_sequence");
    assert.equal(
      mapRestPath("GET", "/api/v1/candidates", { timelineId: "tl1" })?.args.timelineId,
      "tl1",
    );
  });
});

describe("png sequence encoder", () => {
  it("writes a real PNG signature and IHDR", () => {
    const frame = solid(16, 12, 200, 40, 40);
    const png = encodePng(frame);
    assert.equal(png[0], 137);
    assert.equal(png[1], 80);
    assert.equal(png[2], 78);
    assert.equal(png[3], 71);
    const ascii = png.subarray(12, 16).toString("ascii");
    assert.equal(ascii, "IHDR");
    assert.ok(png.length > 80);
  });
});

describe("frame graph provenance", () => {
  it("writes GENERATED_FROM from keys onto generated frames, never self-loops", () => {
    const edges = betweenEdges("k100", ["g101", "g102"], "k110");
    assert.ok(edges.every((e) => e.fromId !== e.toId));
    assert.ok(edges.some((e) => e.type === "GENERATED_FROM" && e.fromId === "k100" && e.toId === "g101"));
    assert.ok(edges.some((e) => e.type === "BETWEEN" && e.fromId === "g102" && e.toId === "k110"));
  });
});

describe("generation resolution policy", () => {
  it("preview shrinks wide frames; production keeps source size", () => {
    const preview = resolveGenerationSize({ width: 1920, height: 1080 }, "preview");
    const prod = resolveGenerationSize({ width: 1920, height: 1080 }, "production");
    assert.equal(preview.width, 960);
    assert.ok(preview.height < 1080);
    assert.equal(prod.width, 1920);
    assert.equal(prod.height, 1080);
    const src = solid(32, 16, 200, 10, 10);
    const small = downscaleRgba(src, 8, 4);
    assert.equal(small.width, 8);
    assert.equal(small.height, 4);
  });
});

describe("keyframe pair count bounds", () => {
  const base = {
    timelineId: "t",
    startFrame: 100,
    endFrame: 110,
    startExists: true,
    endExists: true,
    startHasAsset: true,
    endHasAsset: true,
  };

  it("accepts a count that exactly fills the interior", () => {
    const p = validateKeyframePair({ ...base, desiredInbetweenCount: 9 });
    assert.equal(p.desired_inbetween_count, 9);
    // The last generated number must stay strictly before the end key.
    const numbers = generatedFrameNumbers(100, p.desired_inbetween_count);
    assert.equal(numbers[numbers.length - 1], 109);
  });

  it("rejects a count that would spill onto and past the end keyframe", () => {
    // 10 inbetweens between F100 and F110 would be laid out as 101..110,
    // overwriting the end key itself; 40 would run to F140.
    for (const count of [10, 11, 40]) {
      assert.throws(
        () => validateKeyframePair({ ...base, desiredInbetweenCount: count }),
        (err) => err instanceof FrameLabError && err.code === "INVALID_FRAME_RANGE",
        `count ${count} should not fit`,
      );
    }
  });

  it("rejects any inbetween between adjacent keys", () => {
    assert.throws(
      () =>
        validateKeyframePair({ ...base, endFrame: 101, desiredInbetweenCount: 1 }),
      (err) => err instanceof FrameLabError && err.code === "INVALID_FRAME_RANGE",
    );
  });
});
