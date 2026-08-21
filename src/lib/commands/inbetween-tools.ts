/** V0.3 inbetween commands. Candidate-first. No fake generative pixels. */

import { getInbetween, getInterpolation } from "@/lib/ai/providers";
import { constraintWarnings, type AnimationConstraint } from "@/lib/domain/animation-constraints";
import { parseAnimationIntent } from "@/lib/domain/animation-intent";
import { fail, FrameLabError } from "@/lib/domain/errors";
import { frameDurationMs } from "@/lib/domain/fps";
import { decodeJpegBase64, encodeJpegBase64, encodePng, hashBytes, makeThumbnail } from "@/lib/domain/image-codec";
import { generatedFrameNumbers, validateKeyframePair } from "@/lib/domain/keyframe-pair";
import { buildMotionPlan, hashMotionPlan, type MotionPlan } from "@/lib/domain/motion-plan";
import { fuseConsistency, mergeProblemRanges, toProblemFrames } from "@/lib/domain/consistency-engine";
import { analyzeMotionSequence } from "@/lib/domain/motion-analysis";
import { estimatePoseLite, poseContinuity } from "@/lib/domain/pose-lite";
import { histogram16, histogramDistance, lumaVariance, meanAbsDiff, meanLuma } from "@/lib/domain/pixel-metrics";
import { midpointBreakdown, scoreTransition } from "@/lib/domain/transition-analysis";
import { linearBlendCapabilities, resolveInbetweenStrategy } from "@/lib/domain/inbetween-strategy";
import { planMinimalRegeneration, assertNotProtected } from "@/lib/domain/regeneration-planner";
import { sequentialEdges, betweenEdges } from "@/lib/domain/frame-graph";
import { logEvent } from "@/lib/obs/log";
import { downscaleRgba, resolveGenerationSize } from "@/lib/domain/generation-resolution";
import { detectContactBreaks } from "@/lib/domain/contact";
import { detectTrackBreaks } from "@/lib/domain/track-continuity";
import {
  generationCacheGet,
  generationCacheKey,
  generationCacheSet,
} from "@/lib/domain/generation-cache";
import type { FrameType, MotionCurve } from "@/lib/domain/types";
import { nid } from "@/lib/domain/ids";
import * as repo from "@/lib/framelab/repo";
import { ownProject } from "./ownership.ts";
import { putBytes, putJpeg } from "@/lib/storage/local";
import { withJob } from "@/lib/jobs/queue";
import type { CommandContext } from "./execute.ts";

type CandidateFrame = {
  frameNumber: number;
  imageData: string;
  thumbnailData: string;
  contentHash: string;
  width: number;
  height: number;
  motion_progress: number;
  generated_from_start: number;
  generated_from_end: number;
  provider: string;
  model: string;
};

async function ownTimeline(ctx: CommandContext, timelineId: string) {
  const t = await repo.getTimeline(timelineId);
  if (!t) fail("FRAME_NOT_FOUND", "Timeline not found", 404);
  await ownProject(ctx, t.project_id);
  return t;
}

export async function createKeyframePairCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const timelineId = String(args.timelineId ?? "");
  if (!timelineId) fail("VALIDATION_ERROR", "timelineId required");
  const t = await ownTimeline(ctx, timelineId);
  const start = Number(args.startFrame ?? args.frameA);
  const end = Number(args.endFrame ?? args.frameB);
  const a = await repo.getFrameByNumber(t.id, start);
  const b = await repo.getFrameByNumber(t.id, end);
  const promote = args.promoteKeys === true;
  const pair = validateKeyframePair({
    timelineId: t.id,
    startFrame: start,
    endFrame: end,
    desiredInbetweenCount: typeof args.count === "number" ? args.count : undefined,
    startExists: Boolean(a),
    endExists: Boolean(b),
    startHasAsset: Boolean(a?.image_data),
    endHasAsset: Boolean(b?.image_data),
    startLockedInvalid: Boolean(a?.is_locked && a.frame_type !== "KEY"),
    endLockedInvalid: Boolean(b?.is_locked && b.frame_type !== "KEY"),
    startIsKey: promote ? true : a?.frame_type === "KEY",
    endIsKey: promote ? true : b?.frame_type === "KEY",
  });
  const promoted_to_key: number[] = [];
  if (promote && a && a.frame_type !== "KEY" && !a.is_locked) {
    await repo.updateFrame(a.id, { frame_type: "KEY" });
    promoted_to_key.push(start);
  }
  if (promote && b && b.frame_type !== "KEY" && !b.is_locked) {
    await repo.updateFrame(b.id, { frame_type: "KEY" });
    promoted_to_key.push(end);
  }
  const id = await repo.insertKeyframePair({
    timelineId: t.id,
    startFrameId: a?.id ?? null,
    endFrameId: b?.id ?? null,
    startFrame: pair.start_frame_number,
    endFrame: pair.end_frame_number,
    gap: pair.frame_gap,
    count: pair.desired_inbetween_count,
  });
  return { id, ...pair, start_frame_id: a?.id, end_frame_id: b?.id, promoted_to_key };
}

export async function getKeyframePairCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const id = String(args.pairId ?? args.id ?? "");
  if (!id) fail("VALIDATION_ERROR", "pairId required");
  const row = await repo.getKeyframePair(id);
  if (!row) fail("KEYFRAME_NOT_FOUND", "Keyframe pair not found", 404);
  await ownTimeline(ctx, row.timeline_id);
  return row;
}

export async function analyzeKeyframeTransition(ctx: CommandContext, args: Record<string, unknown>) {
  let timelineId = String(args.timelineId ?? "");
  let start = Number(args.startFrame ?? args.frameA);
  let end = Number(args.endFrame ?? args.frameB);
  const pairId = String(args.pairId ?? args.id ?? "");
  if (pairId && (!timelineId || !Number.isFinite(start) || !Number.isFinite(end))) {
    const row = await repo.getKeyframePair(pairId);
    if (!row) fail("KEYFRAME_NOT_FOUND", "Keyframe pair not found", 404);
    timelineId = row.timeline_id;
    start = row.start_frame_number;
    end = row.end_frame_number;
  }
  const t = await ownTimeline(ctx, timelineId);
  const a = await repo.getFrameByNumber(t.id, start);
  const b = await repo.getFrameByNumber(t.id, end);
  if (!a || !b) fail("KEYFRAME_NOT_FOUND", "Keyframe not found", 404);
  if (!a.image_data || !b.image_data) fail("FRAME_ASSET_UNAVAILABLE", "Keyframe asset missing");
  const ra = decodeJpegBase64(a.image_data);
  const rb = decodeJpegBase64(b.image_data);
  const motion = analyzeMotionSequence([
    { number: start, rgba: ra },
    { number: end, rgba: rb },
  ]);
  const pa = estimatePoseLite(ra, start);
  const pb = estimatePoseLite(rb, end, { prev: ra });
  let poseDisp = 0;
  let nJoints = 0;
  for (const ka of pa.keypoints) {
    const kb = pb.keypoints.find((k) => k.name === ka.name);
    if (!kb) continue;
    poseDisp += Math.hypot(kb.x - ka.x, kb.y - ka.y);
    nJoints += 1;
  }
  const chars = await repo.listProjectAssignments(t.project_id);
  const objects = await repo.listProjectObjectAssignments(t.project_id);
  const tracks = await repo.listTrackingPoints(t.project_id);
  const charCount = new Set(chars.filter((c) => c.frame_number === start || c.frame_number === end).map((c) => c.character_id)).size;
  const objCount = new Set(objects.filter((o) => o.frame_number === start || o.frame_number === end).map((o) => o.object_id)).size;
  const hist = 1 - Math.min(1, histogramDistance(histogram16(ra), histogram16(rb)));
  const mae = 1 - Math.min(1, meanAbsDiff(ra, rb));
  const startTracks = tracks.filter((p) => p.frame_number === start);
  const endTracks = tracks.filter((p) => p.frame_number === end);
  let objectDisp = Math.min(1, objCount * 0.2);
  if (startTracks.length && endTracks.length) {
    let d = 0;
    let n = 0;
    for (const s of startTracks) {
      const e = endTracks.find((x) => x.name === s.name);
      if (!e) continue;
      d += Math.hypot(e.x - s.x, e.y - s.y) / Math.max(ra.width, 1);
      n += 1;
    }
    if (n) objectDisp = d / n;
  }
  const features = {
    mean_motion: motion[0]?.mean_motion ?? 0,
    pose_displacement: nJoints ? poseDisp / nJoints : 0,
    object_displacement: objectDisp,
    visual_similarity: (hist + mae) / 2,
    character_count: charCount,
    contact_count: detectContactBreaks(tracks.map((p) => ({ name: p.name, x: p.x, y: p.y, frame_number: p.frame_number }))).length,
    camera_motion: 0,
    occlusion: Boolean(chars.some((c) => c.occluded && (c.frame_number === start || c.frame_number === end))),
  };
  const analysis = scoreTransition(features);
  const interpolationAvailable = getInbetween("linear-blend").available();
  const generativeAvailable = getInbetween("wan").available();
  const strategy = resolveInbetweenStrategy({
    complexity: analysis.complexity,
    interpolationAvailable,
    generativeAvailable,
  });
  return {
    analysis,
    strategy,
    suggested_breakdown: analysis.suggest_breakdown ? midpointBreakdown(start, end) : null,
    motion: motion[0] ?? null,
    poses: [pa, pb],
  };
}

export async function suggestBreakdownFrames(ctx: CommandContext, args: Record<string, unknown>) {
  const tr = await analyzeKeyframeTransition(ctx, args);
  return {
    frames: tr.suggested_breakdown != null ? [tr.suggested_breakdown] : [],
    reason: tr.analysis.suggest_breakdown
      ? `Complexity ${tr.analysis.complexity}. Suggest a breakdown at F${tr.suggested_breakdown}.`
      : "No breakdown required for this pair.",
    auto: false,
  };
}

function parseConstraints(args: Record<string, unknown>, start: number, end: number): AnimationConstraint[] {
  const out: AnimationConstraint[] = [];
  const flags: Array<[string, AnimationConstraint["kind"]]> = [
    ["preserveCharacter", "PRESERVE_CHARACTER"],
    ["preserveFace", "PRESERVE_FACE"],
    ["preserveBackground", "PRESERVE_BACKGROUND"],
    ["preserveClothing", "PRESERVE_CLOTHING"],
    ["preserveHair", "PRESERVE_HAIR"],
    ["preserveBody", "PRESERVE_BODY"],
    ["preserveObject", "PRESERVE_OBJECT"],
    ["maintainContact", "MAINTAIN_CONTACT"],
    ["keepCameraStatic", "KEEP_CAMERA_STATIC"],
  ];
  for (const [k, kind] of flags) {
    if (args[k] === true) out.push({ kind, start_frame: start, end_frame: end });
  }
  if (Array.isArray(args.constraints)) {
    for (const c of args.constraints) {
      if (typeof c === "string") out.push({ kind: c as AnimationConstraint["kind"], start_frame: start, end_frame: end });
      else if (c && typeof c === "object" && "kind" in c) out.push(c as AnimationConstraint);
    }
  }
  if (typeof args.intent === "string") {
    const parsed = parseAnimationIntent(args.intent, { start, end });
    out.push(...parsed.constraints);
  }
  const seen = new Set<string>();
  return out.filter((c) => {
    if (seen.has(c.kind)) return false;
    seen.add(c.kind);
    return true;
  });
}

export async function createMotionPlanCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const timelineId = String(args.timelineId ?? "");
  const t = await ownTimeline(ctx, timelineId);
  const start = Number(args.startFrame ?? args.frameA);
  const end = Number(args.endFrame ?? args.frameB);
  const count =
    typeof args.count === "number" ? args.count : Math.max(0, end - start - 1);
  const curve = (typeof args.curve === "string" ? args.curve : "ease_in_out") as MotionCurve;
  const constraints = parseConstraints(args, start, end);
  const chars = await repo.listProjectAssignments(t.project_id);
  const byChar = new Map<string, string>();
  for (const a of chars) if (a.frame_number === start) byChar.set(a.character_id, a.name);
  const objects = await repo.listProjectObjectAssignments(t.project_id);
  const byObj = new Map<string, string>();
  for (const o of objects) if (o.frame_number === start) byObj.set(o.object_id, o.name);
  const tr = await analyzeKeyframeTransition(ctx, args);
  const breakdowns =
    tr.suggested_breakdown != null && args.includeSuggestedBreakdown !== false
      ? [tr.suggested_breakdown]
      : [];
  const pairId = typeof args.pairId === "string" ? args.pairId : null;
  const version = await repo.nextMotionPlanVersion(pairId, t.id);
  const plan = buildMotionPlan({
    start,
    end,
    count,
    curve,
    fps: t.fps,
    constraints,
    breakdowns: typeof args.includeSuggestedBreakdown === "boolean" && !args.includeSuggestedBreakdown ? [] : breakdowns,
    quality: args.quality === "production" ? "production" : "preview",
    camera: { movement: args.keepCameraStatic ? "static" : "unknown" },
    version,
    characters: [...byChar.entries()].map(([id, name]) => ({
      character_id: id,
      motion: { direction: "unknown", distance_normalized: tr.analysis.features.mean_motion / 40 },
      pose_transition: { name, pose_displacement: tr.analysis.features.pose_displacement },
    })),
    objects: [...byObj.entries()].map(([id, name]) => ({
      object_id: id,
      constraint: `follow ${name}`,
    })),
  });
  const id = await repo.insertMotionPlanRow({
    pairId,
    timelineId: t.id,
    version: plan.version,
    planJson: JSON.stringify(plan),
    curve: plan.curve,
  });
  const caps = getInbetween(typeof args.provider === "string" ? args.provider : "linear-blend").capabilities();
  return {
    id,
    plan,
    warnings: constraintWarnings(plan.constraints, caps),
    strategy: tr.strategy,
    transition: tr.analysis,
  };
}

export async function getMotionPlanCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const id = String(args.planId ?? args.id ?? "");
  if (!id) fail("VALIDATION_ERROR", "planId required");
  const row = await repo.getMotionPlanRow(id);
  if (!row) fail("INVALID_MOTION_PLAN", "Motion plan not found", 404);
  await ownTimeline(ctx, row.timeline_id);
  return { id: row.id, version: row.version, curve: row.curve, plan: JSON.parse(row.plan_json) };
}

export async function createInbetweenPlanCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const pair = await createKeyframePairCmd(ctx, args);
  const motion = await createMotionPlanCmd(ctx, { ...args, pairId: pair.id });
  const provider = motion.strategy.provider;
  const inb = getInbetween(typeof args.provider === "string" ? args.provider : provider);
  return {
    pair,
    motion_plan_id: motion.id,
    plan: motion.plan,
    strategy: motion.strategy,
    transition: motion.transition,
    warnings: motion.warnings,
    provider: inb.id,
    available: inb.available(),
    confirmation: {
      title: "產生中間影格",
      start: pair.start_frame_number,
      end: pair.end_frame_number,
      frames: pair.desired_inbetween_count,
      curve: motion.plan.curve,
      constraints: motion.plan.constraints.map((c) => c.kind),
      provider: inb.available() ? inb.id : `${inb.id} (unavailable)`,
      auto: false,
      warnings: motion.warnings,
      blocked: motion.strategy.kind === "suggest_breakdown",
      reason: motion.strategy.kind === "suggest_breakdown" ? motion.strategy.reason : undefined,
      suggested_breakdown: motion.plan.breakdowns[0] ?? null,
    },
  };
}

async function evaluateGenerated(
  ctx: CommandContext,
  timelineId: string,
  start: number,
  end: number,
  decoded: { number: number; rgba: ReturnType<typeof decodeJpegBase64> }[],
) {
  const t = await repo.getTimeline(timelineId);
  if (!t) fail("FRAME_NOT_FOUND", "Timeline not found", 404);
  void ctx;
  void start;
  void end;
  const motion = analyzeMotionSequence(decoded);
  const poses = decoded.map((d, i) =>
    estimatePoseLite(d.rgba, d.number, { prev: i ? decoded[i - 1]!.rgba : null }),
  );
  const poseEvents = poseContinuity(poses, t.fps);
  const lumas = decoded.map((d) => meanLuma(d.rgba));
  const flicker = decoded.map((d, i) => ({
    frame: d.number,
    score: 1 - Math.min(1, lumaVariance(lumas.slice(Math.max(0, i - 2), i + 3)) * 18),
  }));
  const seeds = await repo.listTrackingPoints(t.project_id);
  const trackBreaks = detectTrackBreaks(
    seeds.map((s) => ({
      name: s.name,
      frame: s.frame_number,
      x: s.x,
      y: s.y,
      confidence: s.score,
      status: s.status,
    })),
  );
  const contacts = detectContactBreaks(
    seeds.map((s) => ({ name: s.name, x: s.x, y: s.y, frame_number: s.frame_number })),
  );
  const findings = fuseConsistency({ motion, poseEvents, flicker, trackBreaks, contacts });
  const problems = toProblemFrames(findings);
  const ranges = mergeProblemRanges(problems);
  const scoreOf = (type: string) => {
    const hits = findings.filter((f) => f.type === type);
    return hits.length ? Math.min(...hits.map((h) => h.score)) : null;
  };
  const scores: Record<string, number> = {};
  const pairs: Array<[string, string]> = [
    ["motion_continuity", "MOTION_CONTINUITY"],
    ["pose_continuity", "POSE_CONTINUITY"],
    ["tracking_continuity", "TRACKING_CONTINUITY"],
    ["contact_continuity", "CONTACT_CONTINUITY"],
    ["character_stability", "CHARACTER_STABILITY"],
    ["object_stability", "OBJECT_STABILITY"],
  ];
  for (const [key, type] of pairs) {
    const v = scoreOf(type);
    if (v != null) scores[key] = v;
  }
  return {
    scores,
    problems,
    ranges,
    findings,
  };
}

export async function generateInbetweensCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const timelineId = String(args.timelineId ?? "");
  const t = await ownTimeline(ctx, timelineId);
  const start = Number(args.startFrame ?? args.frameA);
  const end = Number(args.endFrame ?? args.frameB);
  const a = await repo.getFrameByNumber(t.id, start);
  const b = await repo.getFrameByNumber(t.id, end);
  if (!a || !b) fail("KEYFRAME_NOT_FOUND", "Keyframe not found", 404);
  if (a.frame_type !== "KEY" && args.requireKeys !== false) {
    /* still allowed — pair validation already passed */
  }
  const planned = await createInbetweenPlanCmd(ctx, args);
  const providerName =
    typeof args.provider === "string"
      ? args.provider
      : planned.strategy.provider === "wan" && !getInbetween("wan").available()
        ? "linear-blend"
        : planned.strategy.provider;
  const inb = getInbetween(providerName);
  if (!inb.available()) {
    fail("PROVIDER_NOT_AVAILABLE", `${inb.id} is not loaded. Use provider=linear-blend.`);
  }
  if (planned.strategy.kind === "suggest_breakdown" && args.force !== true) {
    return {
      blocked: true,
      reason: planned.strategy.reason,
      suggested_breakdown: planned.plan.breakdowns[0] ?? null,
      confirmation: planned.confirmation,
      note: "Pass force=true after the user declines the breakdown.",
    };
  }
  const plan = planned.plan as MotionPlan;
  const count = plan.count;
  const raFull = decodeJpegBase64(a.image_data);
  const rbFull = decodeJpegBase64(b.image_data);
  const quality = plan.quality;
  const size = resolveGenerationSize(raFull, quality);
  const ra = downscaleRgba(raFull, size.width, size.height);
  const rb = downscaleRgba(rbFull, size.width, size.height);
  const cacheKey = generationCacheKey({
    startHash: a.content_hash,
    endHash: b.content_hash,
    provider: inb.id,
    modelVersion: "0.3",
    seed: typeof args.seed === "number" ? args.seed : null,
    motionPlanHash: hashMotionPlan(plan),
    constraintHash: JSON.stringify(plan.constraints),
    resolution: `${quality}:${size.width}x${size.height}`,
    frameCount: count,
  });
  const genStarted = Date.now();
  logEvent("generation.started", {
    provider: inb.id,
    quality,
    width: size.width,
    height: size.height,
    frame_count: count,
  });

  const wrapped = await withJob({
    userId: ctx.userId,
    projectId: t.project_id,
    type: "GENERATE_INBETWEENS",
    payload: { timelineId: t.id, start, end, count, provider: inb.id, quality, width: size.width, height: size.height },
    provider: inb.id,
    model: inb.id,
    work: async (_id, progress) => {
      const stage = async (n: number, label: string, extra?: Record<string, unknown>) => {
        await repo.updateJob(_id, {
          progress: n,
          result_json: JSON.stringify({ stage: { label, current: extra?.current, total: extra?.total }, ...extra }),
        });
      };
      await stage(8, "正在分析關鍵影格…");
      let generated = generationCacheGet<ReturnType<typeof decodeJpegBase64>[]>(cacheKey);
      const cacheHit = Boolean(generated);
      if (!generated) {
        await stage(22, "正在建立動作計畫…");
        const runGenerate = async (srcA: typeof ra, srcB: typeof rb, n: number) =>
          inb.generate({
            start: srcA,
            end: srcB,
            count: n,
            motionPlan: { ...plan, count: n, quality },
            characterRefs: plan.characters.map((c) => ({ id: c.character_id, name: String(c.pose_transition.name ?? "") })),
            objectRefs: plan.objects.map((o) => ({ id: o.object_id, name: o.constraint })),
            constraints: plan.constraints,
            config: { seed: typeof args.seed === "number" ? args.seed : undefined, quality },
          });
        try {
          generated = await runGenerate(ra, rb, count);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const oom = /out of memory|cuda.?oom|GPU_OUT_OF_MEMORY/i.test(msg);
          if (oom) {
            const preview = resolveGenerationSize(raFull, "preview");
            const a2 = downscaleRgba(raFull, preview.width, preview.height);
            const b2 = downscaleRgba(rbFull, preview.width, preview.height);
            const half = Math.max(1, Math.floor(count / 2));
            const left = await runGenerate(a2, b2, half);
            const right = await runGenerate(a2, b2, count - half);
            generated = [...left, ...right];
          } else if (err instanceof FrameLabError) {
            throw err;
          } else {
            fail("GENERATION_FAILED", msg);
          }
        }
        if (!generated) fail("GPU_OUT_OF_MEMORY", "Generation failed after one OOM retry.");
        generationCacheSet(cacheKey, generated);
      }
      const numbers = generatedFrameNumbers(start, count);
      const frames: CandidateFrame[] = [];
      const decoded = [
        { number: start, rgba: ra },
        ...generated.map((g, i) => ({ number: numbers[i]!, rgba: g })),
        { number: end, rgba: rb },
      ];
      for (let i = 0; i < generated.length; i += 1) {
        const g = generated[i]!;
        const n = numbers[i]!;
        await stage(30 + Math.round(((i + 1) / Math.max(1, generated.length)) * 40), `正在產生影格… ${i + 1} / ${count}`, {
          current: i + 1,
          total: count,
        });
        const imageData = encodeJpegBase64(g, size.jpegQ);
        const thumbnailData = makeThumbnail(g);
        const contentHash = hashBytes(imageData);
        await putJpeg(
          t.project_id,
          "generated",
          `cand-F${String(n).padStart(4, "0")}-${contentHash.slice(0, 8)}.jpg`,
          imageData,
        ).catch(() => undefined);
        frames.push({
          frameNumber: n,
          imageData,
          thumbnailData,
          contentHash,
          width: g.width,
          height: g.height,
          motion_progress: plan.spacing[i] ?? (i + 1) / (count + 1),
          generated_from_start: start,
          generated_from_end: end,
          provider: inb.id,
          model: inb.id,
        });
        await progress(70 + Math.round(((i + 1) / Math.max(1, generated.length)) * 15), {
          current: i + 1,
          total: count,
          label: `正在產生影格… ${i + 1} / ${count}`,
        });
      }
      await stage(82, "正在評估產生的影格…");
      const evalStarted = Date.now();
      const evaluation = await evaluateGenerated(ctx, t.id, start, end, decoded);
      const evalMs = Date.now() - evalStarted;
      const candidateId = await repo.insertCandidate({
        projectId: t.project_id,
        timelineId: t.id,
        pairId: planned.pair.id,
        motionPlanId: planned.motion_plan_id,
        jobId: _id,
        provider: inb.id,
        model: inb.id,
        quality,
        status: "ready",
        seed: typeof args.seed === "number" ? args.seed : null,
        framesJson: JSON.stringify(
          frames.map((f) => ({
            ...f,
            generation_job_id: _id,
            motion_plan_id: planned.motion_plan_id,
            model_version: "0.3",
            seed: typeof args.seed === "number" ? args.seed : null,
            created_at: new Date().toISOString(),
          })),
        ),
        evaluationJson: JSON.stringify({
          scores: evaluation.scores,
          ranges: evaluation.ranges,
          eval_ms: evalMs,
        }),
      });
      await repo.insertGeneratedIssues(
        candidateId,
        evaluation.problems.map((p) => ({
          frame: p.frame_number,
          category: p.category,
          severity: p.severity,
          score: p.score,
          reason: p.reason,
        })),
      );
      await stage(94, "正在檢查一致性…");
      await progress(96);
      const durationMs = Date.now() - genStarted;
      logEvent("generation.completed", {
        provider: inb.id,
        quality,
        width: size.width,
        height: size.height,
        frame_count: frames.length,
        duration_ms: durationMs,
        fps_generated: durationMs > 0 ? Number((frames.length / (durationMs / 1000)).toFixed(2)) : 0,
        eval_ms: evalMs,
        cache_hit: cacheHit,
        gpu_mem_mb: 0,
      });
      return {
        candidateId,
        provider: inb.id,
        count: frames.length,
        quality,
        width: size.width,
        height: size.height,
        duration_ms: durationMs,
        evaluation: {
          scores: evaluation.scores,
          ranges: evaluation.ranges,
          problems: evaluation.problems.slice(0, 12),
        },
        warnings: planned.warnings,
        plan,
        frames: frames.map((f) => ({
          frameNumber: f.frameNumber,
          motion_progress: f.motion_progress,
          contentHash: f.contentHash,
          thumbnailData: f.thumbnailData,
          imageData: f.imageData,
        })),
        note: "Candidate only — active timeline unchanged until accept_generated_frames.",
      };
    },
    summarize: (r) => ({ candidateId: r.candidateId, count: r.count, provider: r.provider, duration_ms: r.duration_ms }),
  });
  return { ...wrapped.result, jobId: wrapped.jobId, confirmation: planned.confirmation };
}

export async function getCandidateCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const candidateId = String(args.candidateId ?? args.id ?? "");
  if (!candidateId) fail("VALIDATION_ERROR", "candidateId required");
  const cand = await repo.getCandidate(candidateId);
  if (!cand) fail("CANDIDATE_NOT_FOUND", "Candidate not found", 404);
  await ownTimeline(ctx, cand.timeline_id);
  const frames = JSON.parse(cand.frames_json) as CandidateFrame[];
  let evaluation: unknown = {};
  try {
    evaluation = JSON.parse(cand.evaluation_json || "{}");
  } catch {
    evaluation = {};
  }
  return {
    id: cand.id,
    timelineId: cand.timeline_id,
    pairId: cand.pair_id,
    motionPlanId: cand.motion_plan_id,
    jobId: cand.job_id,
    provider: cand.provider,
    model: cand.model,
    quality: cand.quality,
    status: cand.status,
    seed: cand.seed,
    evaluation,
    frames: frames.map((f) => ({
      frameNumber: f.frameNumber,
      thumbnailData: f.thumbnailData,
      motion_progress: f.motion_progress,
      contentHash: f.contentHash,
      generated_from_start: f.generated_from_start,
      generated_from_end: f.generated_from_end,
      provider: f.provider,
      model: f.model,
    })),
    note: "Candidate only — not the active timeline.",
  };
}

export async function listCandidatesCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const timelineId = String(args.timelineId ?? "");
  await ownTimeline(ctx, timelineId);
  return { candidates: await repo.listCandidates(timelineId) };
}

export async function getGenerationJobCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const jobId = String(args.jobId ?? "");
  if (!jobId) fail("VALIDATION_ERROR", "jobId required");
  const job = await repo.getJob(ctx.userId, jobId);
  if (!job) fail("FRAME_NOT_FOUND", "Job not found", 404);
  return job;
}

export async function evaluateInbetweensCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const candidateId = String(args.candidateId ?? args.id ?? "");
  if (!candidateId) fail("VALIDATION_ERROR", "candidateId required");
  const cand = await repo.getCandidate(candidateId);
  if (!cand) fail("CANDIDATE_NOT_FOUND", "Candidate not found", 404);
  await ownTimeline(ctx, cand.timeline_id);
  const frames = JSON.parse(cand.frames_json) as CandidateFrame[];
  if (!frames.length) fail("EVALUATION_FAILED", "Candidate has no frames.");
  const start = frames[0]!.generated_from_start;
  const end = frames[0]!.generated_from_end;
  const a = await repo.getFrameByNumber(cand.timeline_id, start);
  const b = await repo.getFrameByNumber(cand.timeline_id, end);
  if (!a || !b) fail("KEYFRAME_NOT_FOUND", "Pair frames missing", 404);
  const decoded = [
    { number: start, rgba: decodeJpegBase64(a.image_data) },
    ...frames.map((f) => ({ number: f.frameNumber, rgba: decodeJpegBase64(f.imageData) })),
    { number: end, rgba: decodeJpegBase64(b.image_data) },
  ];
  const evaluation = await evaluateGenerated(ctx, cand.timeline_id, start, end, decoded);
  await repo.updateCandidate(candidateId, {
    evaluationJson: JSON.stringify({ scores: evaluation.scores, ranges: evaluation.ranges }),
  });
  await repo.insertGeneratedIssues(
    candidateId,
    evaluation.problems.map((p) => ({
      frame: p.frame_number,
      category: p.category,
      severity: p.severity,
      score: p.score,
      reason: p.reason,
    })),
  );
  return { candidateId, scores: evaluation.scores, ranges: evaluation.ranges, problems: evaluation.problems };
}

export async function getGeneratedIssuesCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const candidateId = String(args.candidateId ?? "");
  if (!candidateId) fail("VALIDATION_ERROR", "candidateId required");
  const cand = await repo.getCandidate(candidateId);
  if (!cand) fail("CANDIDATE_NOT_FOUND", "Candidate not found", 404);
  await ownTimeline(ctx, cand.timeline_id);
  return { issues: await repo.listGeneratedIssues(candidateId) };
}

export async function regenerateInbetweenRangeCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const candidateId = String(args.candidateId ?? "");
  const cand = await repo.getCandidate(candidateId);
  if (!cand) fail("CANDIDATE_NOT_FOUND", "Candidate not found", 404);
  const t = await ownTimeline(ctx, cand.timeline_id);
  const issues = await repo.listGeneratedIssues(candidateId);
  const framesMeta = await repo.listFramesMeta(t.id);
  const regen = planMinimalRegeneration(
    issues.map((i) => ({
      frame: i.frame_number,
      category: i.category,
      severity: i.severity as "warning" | "error" | "critical" | "info",
    })),
    framesMeta.map((f) => ({
      frameNumber: f.frame_number,
      frameType: f.frame_type,
      isLocked: f.is_locked,
    })),
  );
  if (!regen) return { candidateId, regenerated: [], note: "No problem frames to regenerate." };
  const [rs, re] = regen.regenerate_range;
  const left = await repo.getFrameByNumber(t.id, regen.boundary_start);
  const right = await repo.getFrameByNumber(t.id, regen.boundary_end);
  const candFrames = JSON.parse(cand.frames_json) as CandidateFrame[];
  const leftImg =
    left && !issues.some((i) => i.frame_number === regen.boundary_start)
      ? left.image_data
      : candFrames.find((f) => f.frameNumber === regen.boundary_start)?.imageData ?? left?.image_data;
  const rightImg =
    right && !issues.some((i) => i.frame_number === regen.boundary_end)
      ? right.image_data
      : candFrames.find((f) => f.frameNumber === regen.boundary_end)?.imageData ?? right?.image_data;
  if (!leftImg || !rightImg) fail("FRAME_ASSET_UNAVAILABLE", "Regeneration boundaries missing assets.");
  const count = re - rs + 1;
  const inb = getInbetween(cand.provider);
  if (!inb.available()) fail("PROVIDER_NOT_AVAILABLE", `${inb.id} is not loaded.`);
  const curve = (typeof args.curve === "string" ? args.curve : "ease_in_out") as MotionCurve;
  const plan = buildMotionPlan({
    start: regen.boundary_start,
    end: regen.boundary_end,
    count,
    curve,
    fps: t.fps,
  });
  const generated = await inb.generate({
    start: decodeJpegBase64(leftImg),
    end: decodeJpegBase64(rightImg),
    count,
    motionPlan: plan,
  });
  const nextFrames = candFrames.map((f) => ({ ...f }));
  for (let i = 0; i < generated.length; i += 1) {
    const n = rs + i;
    const existing = framesMeta.find((f) => f.frame_number === n);
    if (existing?.is_locked || existing?.frame_type === "KEY" || existing?.frame_type === "HOLD" || existing?.frame_type === "BREAKDOWN") continue;
    const g = generated[i]!;
    const imageData = encodeJpegBase64(g, 80);
    const thumbnailData = makeThumbnail(g);
    const contentHash = hashBytes(imageData);
    const slot = nextFrames.findIndex((f) => f.frameNumber === n);
    const row: CandidateFrame = {
      frameNumber: n,
      imageData,
      thumbnailData,
      contentHash,
      width: g.width,
      height: g.height,
      motion_progress: plan.spacing[i] ?? 0,
      generated_from_start: regen.boundary_start,
      generated_from_end: regen.boundary_end,
      provider: inb.id,
      model: inb.id,
    };
    if (slot >= 0) nextFrames[slot] = row;
    else nextFrames.push(row);
  }
  const pairStart = candFrames[0]?.generated_from_start ?? regen.boundary_start;
  const pairEnd = candFrames[0]?.generated_from_end ?? regen.boundary_end;
  const startKey = await repo.getFrameByNumber(t.id, pairStart);
  const endKey = await repo.getFrameByNumber(t.id, pairEnd);
  let evaluation: Awaited<ReturnType<typeof evaluateGenerated>> | null = null;
  if (startKey?.image_data && endKey?.image_data) {
    const decoded = [
      { number: pairStart, rgba: decodeJpegBase64(startKey.image_data) },
      ...nextFrames.map((f) => ({ number: f.frameNumber, rgba: decodeJpegBase64(f.imageData) })),
      { number: pairEnd, rgba: decodeJpegBase64(endKey.image_data) },
    ];
    evaluation = await evaluateGenerated(ctx, t.id, pairStart, pairEnd, decoded);
  }
  const newId = await repo.insertCandidate({
    projectId: t.project_id,
    timelineId: t.id,
    pairId: cand.pair_id,
    motionPlanId: cand.motion_plan_id,
    provider: inb.id,
    model: inb.id,
    quality: cand.quality,
    status: "ready",
    seed: cand.seed,
    framesJson: JSON.stringify(nextFrames),
    evaluationJson: evaluation
      ? JSON.stringify({ scores: evaluation.scores, ranges: evaluation.ranges })
      : cand.evaluation_json,
  });
  if (evaluation) {
    await repo.insertGeneratedIssues(
      newId,
      evaluation.problems.map((p) => ({
        frame: p.frame_number,
        category: p.category,
        severity: p.severity,
        score: p.score,
        reason: p.reason,
      })),
    );
  }
  return {
    previousCandidateId: candidateId,
    previousFrames: candFrames.map((f) => ({
      frameNumber: f.frameNumber,
      motion_progress: f.motion_progress,
      thumbnailData: f.thumbnailData,
      imageData: f.imageData,
    })),
    candidateId: newId,
    regenerated: generatedFrameNumbers(rs - 1, count),
    plan: regen,
    evaluation: evaluation
      ? { scores: evaluation.scores, ranges: evaluation.ranges, problems: evaluation.problems.slice(0, 12) }
      : undefined,
    frames: nextFrames.map((f) => ({
      frameNumber: f.frameNumber,
      motion_progress: f.motion_progress,
      contentHash: f.contentHash,
      thumbnailData: f.thumbnailData,
      imageData: f.imageData,
    })),
    note: "New candidate created. Previous candidate kept. Re-evaluated.",
  };
}

export async function acceptGeneratedFramesCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const candidateId = String(args.candidateId ?? "");
  const cand = await repo.getCandidate(candidateId);
  if (!cand) fail("CANDIDATE_NOT_FOUND", "Candidate not found", 404);
  const t = await ownTimeline(ctx, cand.timeline_id);
  const frames = JSON.parse(cand.frames_json) as CandidateFrame[];
  const startN = frames[0]?.generated_from_start;
  const endN = frames[0]?.generated_from_end;
  const snapshots: Array<{
    frameId: string;
    frameNumber: number;
    imageData: string;
    thumbnailData: string;
    frameType: string;
    durationMs: number;
    notes: string;
    contentHash: string;
  }> = [];
  const accepted: number[] = [];
  const skipped_protected: number[] = [];
  const isProtected = (row: repo.FrameRow | null | undefined) =>
    Boolean(row && (row.is_locked || row.frame_type === "KEY" || row.frame_type === "HOLD" || row.frame_type === "BREAKDOWN"));

  for (const f of frames) {
    const existing = await repo.getFrameByNumber(t.id, f.frameNumber);
    if (isProtected(existing)) {
      skipped_protected.push(f.frameNumber);
      continue;
    }
    if (existing) {
      snapshots.push({
        frameId: existing.id,
        frameNumber: existing.frame_number,
        imageData: existing.image_data,
        thumbnailData: existing.thumbnail_data,
        frameType: existing.frame_type,
        durationMs: existing.duration_ms,
        notes: existing.notes,
        contentHash: existing.content_hash,
      });
    }
  }
  const revisionId = await repo.insertRevision({
    projectId: t.project_id,
    frameId: snapshots[0]?.frameId ?? null,
    action: "accept_generated_frames",
    source: ctx.source,
    caller: ctx.caller,
    timelineId: t.id,
    startFrame: startN ?? frames[0]?.frameNumber ?? null,
    endFrame: endN ?? frames.at(-1)?.frameNumber ?? null,
    status: "open",
    previous: { frames: snapshots },
    next: { candidateId, count: frames.length },
  });
  const acceptedIds: string[] = [];
  for (const f of frames) {
    const existing = await repo.getFrameByNumber(t.id, f.frameNumber);
    if (isProtected(existing)) continue;
    const originalAsset = existing
      ? `originals/orig-F${String(f.frameNumber).padStart(4, "0")}-${existing.content_hash.slice(0, 8)}.jpg`
      : "";
    if (existing?.image_data) {
      await putJpeg(
        t.project_id,
        "originals",
        `orig-F${String(f.frameNumber).padStart(4, "0")}-${existing.content_hash.slice(0, 8)}.jpg`,
        existing.image_data,
      ).catch(() => undefined);
    }
    await putJpeg(
      t.project_id,
      "generated",
      `F${String(f.frameNumber).padStart(4, "0")}-${f.contentHash.slice(0, 8)}.jpg`,
      f.imageData,
    ).catch(() => undefined);
    if (existing) {
      await repo.insertRevisionFrame({
        revisionId,
        frameId: existing.id,
        frameNumber: f.frameNumber,
        previousHash: existing.content_hash,
      });
      await repo.updateFrame(existing.id, {
        image_data: f.imageData,
        thumbnail_data: f.thumbnailData,
        content_hash: f.contentHash,
        frame_type: "GENERATED",
        width: f.width,
        height: f.height,
        original_asset: originalAsset || undefined,
        active_asset: `generated/F${String(f.frameNumber).padStart(4, "0")}-${f.contentHash.slice(0, 8)}.jpg`,
      });
      acceptedIds.push(existing.id);
    } else {
      const id = nid("frm");
      await repo.insertFrame({
        id,
        timeline_id: t.id,
        frame_number: f.frameNumber,
        timestamp_ms: Math.round((f.frameNumber * 1000) / t.fps),
        duration_ms: Math.round(1000 / t.fps),
        frame_type: "GENERATED",
        image_data: f.imageData,
        thumbnail_data: f.thumbnailData,
        width: f.width,
        height: f.height,
        content_hash: f.contentHash,
        notes: JSON.stringify({
          generated: true,
          generated_from_start: startN,
          generated_from_end: endN,
          provider: f.provider,
          model: f.model,
          motion_plan_id: cand.motion_plan_id,
          generation_job_id: cand.job_id,
          motion_progress: f.motion_progress,
        }),
      });
      acceptedIds.push(id);
    }
    accepted.push(f.frameNumber);
  }
  const startKey = startN != null ? await repo.getFrameByNumber(t.id, startN) : null;
  const endKey = endN != null ? await repo.getFrameByNumber(t.id, endN) : null;
  if (startKey && endKey) {
    for (const e of betweenEdges(startKey.id, acceptedIds, endKey.id)) {
      await repo.insertEdge({
        projectId: t.project_id,
        edgeType: e.type,
        fromKind: e.fromKind,
        fromId: e.fromId,
        toKind: e.toKind,
        toId: e.toId,
      });
    }
  }
  const meta = await repo.listFramesMeta(t.id);
  const recs = meta.map((m) => ({
    id: m.id,
    timelineId: m.timeline_id,
    frameNumber: m.frame_number,
    timestampMs: m.timestamp_ms,
    durationMs: m.duration_ms,
    frameType: m.frame_type as FrameType,
    imageData: "",
    thumbnailData: m.thumbnail_data,
    width: m.width,
    height: m.height,
    isLocked: m.is_locked,
    notes: m.notes,
    contentHash: m.content_hash,
  }));
  for (const e of sequentialEdges(recs)) {
    await repo.insertEdge({
      projectId: t.project_id,
      edgeType: e.type,
      fromKind: e.fromKind,
      fromId: e.fromId,
      toKind: e.toKind,
      toId: e.toId,
    });
  }
  await repo.setTimelineFrameCount(t.id, meta.length);
  await repo.updateCandidate(candidateId, { status: "accepted" });
  logEvent("candidate.accepted", { candidate: candidateId, count: accepted.length });
  void assertNotProtected;
  return { candidateId, revisionId, accepted, skipped_protected };
}

export async function rejectGeneratedFramesCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const candidateId = String(args.candidateId ?? "");
  const cand = await repo.getCandidate(candidateId);
  if (!cand) fail("CANDIDATE_NOT_FOUND", "Candidate not found", 404);
  await ownTimeline(ctx, cand.timeline_id);
  await repo.updateCandidate(candidateId, { status: "rejected" });
  logEvent("candidate.rejected", { candidate: candidateId });
  return { candidateId, status: "rejected", note: "Audit metadata kept. Active timeline unchanged." };
}

export async function exportFrameSequenceCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const timelineId = String(args.timelineId ?? "");
  const t = await ownTimeline(ctx, timelineId);
  const start = typeof args.startFrame === "number" ? args.startFrame : 0;
  const end =
    typeof args.endFrame === "number"
      ? args.endFrame
      : (await repo.listFramesMeta(t.id)).at(-1)?.frame_number ?? 0;
  const frames = (await repo.listFramesFull(t.id)).filter(
    (f) => f.frame_number >= start && f.frame_number <= end,
  );
  const files: string[] = [];
  for (const f of frames) {
    const name = `frame_${String(f.frame_number).padStart(4, "0")}.png`;
    const png = encodePng(decodeJpegBase64(f.image_data));
    await putBytes(t.project_id, "renders", name, png).catch(() => undefined);
    files.push(name);
  }
  return {
    files,
    start,
    end,
    fps: t.fps,
    format: "png",
    note: "PNG sequence. Playback fps is timeline metadata, not frame count.",
  };
}

void getInterpolation;
void linearBlendCapabilities;

export async function getGeneratedFrameCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const id = String(args.id ?? args.frameId ?? args.candidateId ?? "");
  if (!id) fail("VALIDATION_ERROR", "generated frame id required");
  const asCandidate = await repo.getCandidate(id).catch(() => null);
  if (asCandidate) {
    await ownTimeline(ctx, asCandidate.timeline_id);
    const frames = JSON.parse(asCandidate.frames_json) as CandidateFrame[];
    const n = typeof args.frameNumber === "number" ? args.frameNumber : frames[0]?.frameNumber;
    const slot = frames.find((f) => f.frameNumber === n) ?? frames[0];
    if (!slot) fail("CANDIDATE_NOT_FOUND", "Generated frame not on candidate", 404);
    return {
      candidateId: asCandidate.id,
      frameNumber: slot.frameNumber,
      thumbnailData: slot.thumbnailData,
      motion_progress: slot.motion_progress,
      generated_from_start: slot.generated_from_start,
      generated_from_end: slot.generated_from_end,
      provider: slot.provider,
      model: slot.model,
      jobId: asCandidate.job_id,
      motionPlanId: asCandidate.motion_plan_id,
      seed: asCandidate.seed,
      quality: asCandidate.quality,
    };
  }
  const frame = await repo.getFrame(id);
  if (!frame) fail("CANDIDATE_NOT_FOUND", "Generated frame not found", 404);
  await ownTimeline(ctx, frame.timeline_id);
  return {
    frameId: frame.id,
    frameNumber: frame.frame_number,
    frameType: frame.frame_type,
    thumbnailData: frame.thumbnail_data,
    notes: frame.notes,
    provider: "linear-blend",
  };
}

export async function generateBreakdownFrameCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const timelineId = String(args.timelineId ?? "");
  const t = await ownTimeline(ctx, timelineId);
  const start = Number(args.startFrame ?? args.frameA);
  const end = Number(args.endFrame ?? args.frameB);
  const mid = Number.isFinite(Number(args.frameNumber))
    ? Number(args.frameNumber)
    : Math.round((start + end) / 2);
  const a = await repo.getFrameByNumber(t.id, start);
  const b = await repo.getFrameByNumber(t.id, end);
  if (!a?.image_data || !b?.image_data) fail("FRAME_ASSET_UNAVAILABLE", "Keyframe asset missing");
  const existing = await repo.getFrameByNumber(t.id, mid);
  if (existing?.is_locked || existing?.frame_type === "KEY") {
    fail("INVALID_KEYFRAME_PAIR", "Cannot overwrite a locked or KEY frame with a generated breakdown.");
  }
  const inb = getInbetween("linear-blend");
  const ra = decodeJpegBase64(a.image_data);
  const rb = decodeJpegBase64(b.image_data);
  const size = resolveGenerationSize(ra, "preview");
  const generated = await inb.generate({
    start: downscaleRgba(ra, size.width, size.height),
    end: downscaleRgba(rb, size.width, size.height),
    count: 1,
    motionPlan: buildMotionPlan({ start, end, count: 1, curve: "ease_in_out", fps: t.fps }),
  });
  const g = generated[0]!;
  const imageData = encodeJpegBase64(g, size.jpegQ);
  const thumbnailData = makeThumbnail(g);
  const contentHash = hashBytes(imageData);
  if (existing) {
    await repo.updateFrame(existing.id, {
      image_data: imageData,
      thumbnail_data: thumbnailData,
      content_hash: contentHash,
      frame_type: "GENERATED_BREAKDOWN",
      width: g.width,
      height: g.height,
    });
    return { frameId: existing.id, frameNumber: mid, frameType: "GENERATED_BREAKDOWN", note: "AI generated breakdown. Not a human drawing." };
  }
  const id = nid("frm");
  await repo.insertFrame({
    id,
    timeline_id: t.id,
    frame_number: mid,
    timestamp_ms: Math.round((mid * 1000) / t.fps),
    duration_ms: Math.round(1000 / t.fps),
    frame_type: "GENERATED_BREAKDOWN",
    image_data: imageData,
    thumbnail_data: thumbnailData,
    width: g.width,
    height: g.height,
    content_hash: contentHash,
    notes: "GENERATED_BREAKDOWN",
  });
  return { frameId: id, frameNumber: mid, frameType: "GENERATED_BREAKDOWN", note: "AI generated breakdown. Not a human drawing." };
}

export async function setFrameExposureCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const frameId = String(args.frameId ?? "");
  const exposure = Math.max(1, Math.min(4, Math.round(Number(args.exposure ?? args.exposure_count ?? 1))));
  const frame = await repo.getFrame(frameId);
  if (!frame) fail("FRAME_NOT_FOUND", "Frame not found", 404);
  await ownTimeline(ctx, frame.timeline_id);
  const t = await repo.getTimeline(frame.timeline_id);
  const duration = frameDurationMs(t?.fps ?? 24, exposure);
  await repo.updateFrame(frame.id, { duration_ms: duration, exposure_count: exposure });
  return { frameId: frame.id, exposure_count: exposure, duration_ms: duration, note: "exposure_count=2 plays on twos. AI inbetween will not fill a hold." };
}

