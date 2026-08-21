/** V0.2 assist commands. Motion / pose-lite / consistency / repair plan. No fake models. */

import { getOpticalFlow, getPose, getInterpolation } from "@/lib/ai/providers";
import { detectContactBreaks } from "@/lib/domain/contact";
import {
  fuseConsistency,
  mergeProblemRanges,
  toProblemFrames,
  entityStability,
} from "@/lib/domain/consistency-engine";
import { buildAssistResponse, type AssistResponse } from "@/lib/domain/assist";
import {
  pixelsFromNormalized,
} from "@/lib/domain/context-engine";
import { fail } from "@/lib/domain/errors";
import { decodeJpegBase64, encodeJpegBase64, hashBytes, makeThumbnail } from "@/lib/domain/image-codec";
import { analyzeMotionSequence, propagateRegionByTrack } from "@/lib/domain/motion-analysis";
import { lumaVariance, meanLuma, type RegionBox } from "@/lib/domain/pixel-metrics";
import { estimatePoseLite, poseContinuity } from "@/lib/domain/pose-lite";
import { interiorRepairFrames, planRepairWindow } from "@/lib/domain/repair-planner";
import { detectTrackBreaks, canonicalTrackStatus } from "@/lib/domain/track-continuity";
import { analysisCacheKey, cacheGet, cacheSet } from "@/lib/domain/analysis-cache";
import * as repo from "@/lib/framelab/repo";
import { ownProject } from "./ownership.ts";
import { putBytes, putJpeg, projectRoot } from "@/lib/storage/local";
import { withJob } from "@/lib/jobs/queue";
import type { CommandContext } from "./execute.ts";
import { blendRgba } from "@/lib/domain/pixel-metrics";
import { runRtmposeBatch, toPoseEstimate } from "@/lib/ai/rtmpose-worker";
import { runSeaRaft } from "@/lib/ai/sea-raft-worker";
import { existsSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

function parseRegionArg(
  args: Record<string, unknown>,
  width: number,
  height: number,
  frameId: string,
  frameNumber: number,
): RegionBox | null {
  if (!args.region || typeof args.region !== "object") return null;
  const r = args.region as { x?: number; y?: number; w?: number; h?: number; width?: number; height?: number };
  let region: RegionBox = {
    x: Number(r.x ?? 0),
    y: Number(r.y ?? 0),
    w: Number(r.w ?? r.width ?? 0),
    h: Number(r.h ?? r.height ?? 0),
  };
  if (region.w <= 1 && region.h <= 1) {
    region = pixelsFromNormalized(
      {
        type: "rectangle",
        selectionType: "rectangle",
        frameId,
        frameNumber,
        x: region.x,
        y: region.y,
        width: region.w || 0.2,
        height: region.h || 0.2,
      },
      width,
      height,
    );
  }
  return region.w > 0 && region.h > 0 ? region : null;
}

async function persistMotionPairs(
  timelineId: string,
  projectId: string,
  pairs: ReturnType<typeof analyzeMotionSequence>,
  provider: string,
) {
  await repo.replaceMotionData(
    timelineId,
    pairs.map((p) => ({
      frameNumber: p.frame_b,
      magnitude: p.mean_motion,
      direction: Math.atan2(p.dominant_direction.y, p.dominant_direction.x),
      diff: p.mean_motion,
      frameA: p.frame_a,
      frameB: p.frame_b,
      medianMotion: p.median_motion,
      velocityRatio: p.velocity_ratio,
      directionChangeDeg: p.direction_change_deg,
      flowAsset: `flow/F${p.frame_a}-F${p.frame_b}.json`,
      regionJson: JSON.stringify(p.region),
    })),
    provider,
  );
  for (const p of pairs.slice(0, 24)) {
    const asset = JSON.stringify({
      frame_a: p.frame_a,
      frame_b: p.frame_b,
      mean_motion: p.mean_motion,
      median_motion: p.median_motion,
      dominant_direction: p.dominant_direction,
      motion_bbox: p.motion_bbox,
      confidence: p.confidence,
      grid: p.grid.slice(0, 96),
      paths: p.paths ?? [],
    });
    await putBytes(projectId, "flow", `F${p.frame_a}-F${p.frame_b}.json`, Buffer.from(asset)).catch(
      () => undefined,
    );
  }
}

function fusedFrameScores(
  findings: ReturnType<typeof fuseConsistency>,
  frameNumber: number,
) {
  const kinds = [
    "MOTION_CONTINUITY",
    "POSE_CONTINUITY",
    "TRACKING_CONTINUITY",
    "CONTACT_CONTINUITY",
    "CHARACTER_STABILITY",
    "OBJECT_STABILITY",
  ] as const;
  const scores: Record<string, number> = {};
  for (const k of kinds) {
    const hits = findings.filter(
      (f) => f.type === k && (f.frame === frameNumber || f.related_frames.includes(frameNumber)),
    );
    scores[k.toLowerCase()] = hits.length ? Math.min(...hits.map((h) => h.score)) : 1;
  }
  const min = Math.min(...Object.values(scores));
  const severity = min < 0.3 ? "critical" : min < 0.45 ? "error" : min < 0.7 ? "warning" : "ok";
  const categories = kinds.filter((k) => scores[k.toLowerCase()] < 0.7);
  return { scores, severity, categories };
}

async function loadSlice(
  timelineId: string,
  start: number,
  end: number,
) {
  const frames = await repo.listFramesFull(timelineId);
  return frames.filter((f) => f.frame_number >= start && f.frame_number <= end);
}

export async function analyzeMotionAssist(ctx: CommandContext, args: Record<string, unknown>) {
  const t = await (async () => {
    const timelineId = String(args.timelineId ?? "");
    if (!timelineId) fail("VALIDATION_ERROR", "timelineId required");
    const row = await repo.getTimeline(timelineId);
    if (!row) fail("FRAME_NOT_FOUND", "Timeline not found", 404);
    await ownProject(ctx, row.project_id);
    return row;
  })();
  const providerName = typeof args.provider === "string" ? args.provider : "sea-raft";
  const flow = getOpticalFlow(providerName);
  if (!flow.available()) {
    fail(
      "MODEL_NOT_AVAILABLE",
      flow.id === "sea-raft"
        ? "SEA-RAFT worker is not loaded. Use provider=block-match-16 for CPU fallback."
        : `${flow.id} is not loaded. Use provider=block-match-16.`,
    );
  }
  const frames = await repo.listFramesFull(t.id);
  const start = typeof args.startFrame === "number" ? args.startFrame : (typeof args.frame_a === "number" ? args.frame_a : 0);
  const end =
    typeof args.endFrame === "number"
      ? args.endFrame
      : typeof args.frame_b === "number"
        ? args.frame_b
        : frames[frames.length - 1]?.frame_number ?? 0;
  const slice = frames.filter((f) => f.frame_number >= start && f.frame_number <= end);
  const region = slice[0]
    ? parseRegionArg(args, slice[0].width, slice[0].height, slice[0].id, start)
    : null;
  const trackingPts = await repo.listTrackingPoints(t.project_id);
  const seedFrame = slice[0]?.frame_number ?? start;
  const regionFor = region
    ? (frameB: number) =>
        propagateRegionByTrack(
          region,
          seedFrame,
          frameB,
          trackingPts.map((p) => ({ name: p.name, frame: p.frame_number, x: p.x, y: p.y })),
          { width: slice[0]?.width ?? 480, height: slice[0]?.height ?? 270 },
        )
    : undefined;
  const cacheKey = analysisCacheKey({
    analysisType: "motion",
    provider: flow.id,
    frameHashes: slice.map((f) => f.content_hash),
    start,
    end,
    regionHash: region ? `${region.x},${region.y},${region.w},${region.h}` : "full",
  });
  const wrapped = await withJob({
    userId: ctx.userId,
    projectId: t.project_id,
    type: "OPTICAL_FLOW",
    payload: { timelineId: t.id, start, end, provider: flow.id },
    provider: flow.id,
    model: flow.id,
    work: async (_id, progress) => {
      const cached = cacheGet<ReturnType<typeof analyzeMotionSequence>>(cacheKey);
      let pairs = cached;
      if (!pairs) {
        await progress(10, { current: 0, total: slice.length, label: "分析運動" });
        if (flow.id === "sea-raft") {
          const dir = path.join(tmpdir(), "framelab-searaft", String(Date.now()));
          await mkdir(dir, { recursive: true });
          try {
            const files: { number: number; path: string; width: number; height: number }[] = [];
            for (const f of slice) {
              let file = "";
              const rel = f.full_asset;
              if (rel && !rel.startsWith("/api") && !rel.startsWith("data:")) {
                const abs = path.join(projectRoot(t.project_id), rel);
                if (existsSync(abs)) file = abs;
              }
              if (!file) {
                if (!f.image_data) continue;
                file = path.join(dir, `${f.id}.jpg`);
                await writeFile(file, Buffer.from(f.image_data, "base64"));
              }
              files.push({ number: f.frame_number, path: file, width: f.width, height: f.height });
            }
            const pairIns = [];
            for (let i = 1; i < files.length && pairIns.length < 16; i += 1) {
              pairIns.push({
                pathA: files[i - 1]!.path,
                pathB: files[i]!.path,
                frameA: files[i - 1]!.number,
                frameB: files[i]!.number,
                width: files[i]!.width,
                height: files[i]!.height,
              });
            }
            await progress(30, { current: 0, total: pairIns.length, label: "SEA-RAFT 推論" });
            const batch = await runSeaRaft({ pairs: pairIns });
            let prevMean: number | null = null;
            let prevDir: { x: number; y: number } | null = null;
            pairs = batch.pairs.map((p) => {
              const velocity_ratio =
                prevMean != null && prevMean > 0.15 ? p.mean_motion / prevMean : null;
              let direction_change_deg: number | null = null;
              if (prevDir) {
                const dot = Math.max(
                  -1,
                  Math.min(1, p.dominant_direction.x * prevDir.x + p.dominant_direction.y * prevDir.y),
                );
                direction_change_deg = (Math.acos(dot) * 180) / Math.PI;
              }
              const spike =
                (velocity_ratio != null && velocity_ratio >= 2) ||
                (direction_change_deg != null && direction_change_deg >= 55 && p.mean_motion > 0.8);
              const summary = {
                frame_a: p.frameA,
                frame_b: p.frameB,
                mean_motion: p.mean_motion,
                median_motion: p.median_motion,
                dominant_direction: p.dominant_direction,
                velocity_ratio,
                direction_change_deg,
                region: Boolean(region),
                provider: flow.id,
                spike,
                grid: p.grid,
                motion_bbox: null,
                confidence: p.confidence,
                paths: p.paths,
              };
              prevMean = p.mean_motion;
              prevDir = p.dominant_direction;
              return summary;
            });
          } finally {
            await rm(dir, { recursive: true, force: true }).catch(() => undefined);
          }
        } else {
          const decoded = slice.map((f) => ({
            number: f.frame_number,
            rgba: decodeJpegBase64(f.image_data),
          }));
          await progress(40, { current: Math.floor(slice.length / 2), total: slice.length, label: "分析運動" });
          pairs = analyzeMotionSequence(decoded, { region, regionFor, provider: flow.id });
        }
        cacheSet(cacheKey, pairs);
      }
      await progress(80, { current: slice.length, total: slice.length, label: "分析運動" });
      await persistMotionPairs(t.id, t.project_id, pairs, flow.id);
      await progress(95);
      return pairs;
    },
    summarize: (pairs) => ({ samples: pairs.length, provider: flow.id, spikes: pairs.filter((p) => p.spike).length }),
  });
  const pairs = wrapped.result;
  return {
    provider: flow.id,
    device: "cpu",
    jobId: wrapped.jobId,
    samples: pairs.map(({ grid, ...rest }) => rest),
    spikes: pairs.filter((p) => p.spike).map((p) => ({
      frame_a: p.frame_a,
      frame_b: p.frame_b,
      velocity_ratio: p.velocity_ratio,
      direction_change_deg: p.direction_change_deg,
    })),
    note:
      flow.id === "sea-raft"
        ? "SEA-RAFT-S real inference. Sampled vectors stored as JSON assets."
        : "block-match-16 CPU fallback. Not SEA-RAFT. Flow grids stored as JSON assets, not in DB.",
  };
}

export async function analyzePoseAssist(ctx: CommandContext, args: Record<string, unknown>) {
  const timelineId = String(args.timelineId ?? "");
  if (!timelineId) fail("VALIDATION_ERROR", "timelineId required");
  const t = await repo.getTimeline(timelineId);
  if (!t) fail("FRAME_NOT_FOUND", "Timeline not found", 404);
  await ownProject(ctx, t.project_id);
  const requested = typeof args.provider === "string" ? args.provider : "rtmpose";
  const lite = requested === "framelab-pose-lite" || requested === "pose-lite";
  const pose = getPose(lite ? "framelab-pose-lite" : "rtmpose");
  if (!pose.available()) {
    fail(
      "MODEL_NOT_AVAILABLE",
      lite
        ? "pose-lite is not loaded."
        : "RTMPose worker is not loaded. Install workers/gpu-worker/requirements.txt or use provider=framelab-pose-lite.",
    );
  }
  const frames = await repo.listFramesFull(t.id);
  const start = typeof args.startFrame === "number" ? args.startFrame : 0;
  const end = typeof args.endFrame === "number" ? args.endFrame : frames[frames.length - 1]?.frame_number ?? 0;
  const slice = frames.filter((f) => f.frame_number >= start && f.frame_number <= end);
  const region = slice[0]
    ? parseRegionArg(args, slice[0].width, slice[0].height, slice[0].id, start)
    : null;
  const wrapped = await withJob({
    userId: ctx.userId,
    projectId: t.project_id,
    type: "POSE_ANALYSIS",
    payload: { timelineId: t.id, start, end, provider: pose.id },
    provider: pose.id,
    model: pose.id,
    device: pose.id === "rtmpose" ? "cuda-or-cpu" : "cpu",
    work: async (_id, progress) => {
      if (pose.id === "rtmpose") {
        await progress(5, { current: 0, total: slice.length, label: "載入 RTMPose" });
        const dir = path.join(tmpdir(), "framelab-rtmpose", String(Date.now()));
        await mkdir(dir, { recursive: true });
        const inputs = [];
        const temps: string[] = [];
        try {
          for (const f of slice) {
            let file = "";
            const rel = f.full_asset;
            if (rel && !rel.startsWith("/api") && !rel.startsWith("data:")) {
              const abs = path.join(projectRoot(t.project_id), rel);
              if (existsSync(abs)) file = abs;
            }
            if (!file) {
              if (!f.image_data) continue;
              file = path.join(dir, `${f.id}.jpg`);
              await writeFile(file, Buffer.from(f.image_data, "base64"));
              temps.push(file);
            }
            inputs.push({
              id: f.id,
              path: file,
              frameNumber: f.frame_number,
              width: f.width,
              height: f.height,
            });
          }
          await progress(15, { current: 0, total: slice.length, label: "RTMPose 推論" });
          const batch = await runRtmposeBatch(inputs);
          const estimates = batch.poses.map((p) => toPoseEstimate(p, p.id));
          await repo.replacePosesForFrames(
            batch.poses.map((p) => ({
              frameId: p.id,
              frameNumber: p.frameNumber,
              provider: "rtmpose",
              joints: p.keypoints,
              bbox: p.bbox,
              characterId: typeof args.characterId === "string" ? args.characterId : null,
              modelRunId: batch.model,
            })),
          );
          await progress(95, { current: slice.length, total: slice.length, label: "寫入骨架" });
          return {
            estimates,
            events: poseContinuity(estimates, t.fps),
            device: batch.device,
            model: batch.model,
          };
        } finally {
          await rm(dir, { recursive: true, force: true }).catch(() => undefined);
          void temps;
        }
      }
      const estimates = [];
      const poseRows = [];
      let prev = null as ReturnType<typeof decodeJpegBase64> | null;
      for (let i = 0; i < slice.length; i += 1) {
        const f = slice[i];
        const rgba = decodeJpegBase64(f.image_data);
        const est = estimatePoseLite(rgba, f.frame_number, {
          prev,
          region,
          frameId: f.id,
          characterId: typeof args.characterId === "string" ? args.characterId : null,
        });
        estimates.push(est);
        poseRows.push({
          frameId: f.id,
          frameNumber: f.frame_number,
          provider: pose.id,
          joints: est.keypoints,
          bbox: est.bbox,
          characterId: est.character_id,
          modelRunId: pose.id,
        });
        prev = rgba;
        await progress(Math.round(((i + 1) / Math.max(1, slice.length)) * 85), {
          current: i + 1,
          total: slice.length,
          label: "分析姿態",
        });
      }
      await repo.replacePosesForFrames(poseRows);
      const events = poseContinuity(estimates, t.fps);
      return { estimates, events, device: "cpu", model: pose.id };
    },
    summarize: (r) => ({ poses: r.estimates.length, provider: pose.id, model: r.model }),
  });
  return {
    provider: pose.id,
    device: wrapped.result.device,
    model: wrapped.result.model,
    jobId: wrapped.jobId,
    poses: wrapped.result.estimates,
    continuity: wrapped.result.events,
    note:
      pose.id === "rtmpose"
        ? "RTMPose-s + YOLOX-tiny. Real ONNX inference. pose-lite is the basic fallback."
        : "framelab-pose-lite silhouette extrema. Basic mode — not RTMPose.",
  };
}

export async function suggestRepair(ctx: CommandContext, args: Record<string, unknown>): Promise<AssistResponse> {
  const timelineId = String(args.timelineId ?? "");
  if (!timelineId) fail("VALIDATION_ERROR", "timelineId required");
  const t = await repo.getTimeline(timelineId);
  if (!t) fail("FRAME_NOT_FOUND", "Timeline not found", 404);
  await ownProject(ctx, t.project_id);
  if (args.skipJob !== true) {
    const wrapped = await withJob({
      userId: ctx.userId,
      projectId: t.project_id,
      type: "CONSISTENCY_ANALYSIS",
      payload: { timelineId: t.id, startFrame: args.startFrame, endFrame: args.endFrame },
      work: async (_id, progress) => {
        await progress(8, { label: "評估一致性" });
        const result = await suggestRepair(ctx, { ...args, skipJob: true });
        await progress(95, {
          current: result.problem_ranges[0] ? result.problem_ranges[0].end - result.problem_ranges[0].start + 1 : 0,
          total: result.problems.length,
          label: "評估一致性",
        });
        return result;
      },
      summarize: (r) => ({
        ranges: r.problem_ranges.length,
        plan_id: r.plan_id,
        summary: r.summary,
      }),
    });
    return wrapped.result;
  }
  const frames = await repo.listFramesFull(t.id);
  let start = typeof args.startFrame === "number" ? args.startFrame : 0;
  let end = typeof args.endFrame === "number" ? args.endFrame : frames[frames.length - 1]?.frame_number ?? 0;
  let sessionCharacterId: string | null =
    typeof args.characterId === "string" ? args.characterId : null;
  let sessionRegion: RegionBox | null = null;
  let snapshotId: string | null = null;
  if (typeof args.sessionId === "string" && args.sessionId) {
    const session = await repo.getWorkspaceSession(ctx.userId, args.sessionId);
    if (session?.context_json) {
      try {
        const snap = JSON.parse(session.context_json) as {
          selected_range?: [number, number] | null;
          selected_character_id?: string | null;
          selected_character?: { id?: string } | string | null;
          selected_region?: {
            x: number;
            y: number;
            width?: number;
            height?: number;
            w?: number;
            h?: number;
            frameId?: string;
            frameNumber?: number;
          } | null;
        };
        if (typeof args.startFrame !== "number" && snap.selected_range) {
          start = snap.selected_range[0];
          end = snap.selected_range[1];
        }
        if (!sessionCharacterId) {
          if (typeof snap.selected_character_id === "string") {
            sessionCharacterId = snap.selected_character_id;
          } else if (snap.selected_character && typeof snap.selected_character === "object") {
            sessionCharacterId = snap.selected_character.id ?? null;
          } else if (typeof snap.selected_character === "string") {
            sessionCharacterId = snap.selected_character;
          }
        }
        const r = snap.selected_region;
        if (r && frames[0]) {
          sessionRegion = pixelsFromNormalized(
            {
              type: "rectangle",
              selectionType: "rectangle",
              frameId: r.frameId ?? frames[0].id,
              frameNumber: r.frameNumber ?? start,
              x: r.x,
              y: r.y,
              width: r.width ?? r.w ?? 0.2,
              height: r.height ?? r.h ?? 0.2,
            },
            frames[0].width,
            frames[0].height,
          );
        }
      } catch {
        /* ignore malformed session */
      }
    }
  }
  if (args.region && typeof args.region === "object") {
    const r = args.region as { x?: number; y?: number; w?: number; h?: number; width?: number; height?: number };
    sessionRegion = {
      x: Number(r.x ?? 0),
      y: Number(r.y ?? 0),
      w: Number(r.w ?? r.width ?? 0),
      h: Number(r.h ?? r.height ?? 0),
    };
    if (sessionRegion.w <= 1 && sessionRegion.h <= 1 && frames[0]) {
      sessionRegion = pixelsFromNormalized(
        {
          type: "rectangle",
          selectionType: "rectangle",
          frameId: frames[0].id,
          frameNumber: start,
          x: sessionRegion.x,
          y: sessionRegion.y,
          width: sessionRegion.w || 0.2,
          height: sessionRegion.h || 0.2,
        },
        frames[0].width,
        frames[0].height,
      );
    }
  }
  const slice = frames.filter((f) => f.frame_number >= start && f.frame_number <= end);
  const decoded = slice.map((f) => ({
    number: f.frame_number,
    id: f.id,
    rgba: decodeJpegBase64(f.image_data),
    type: f.frame_type,
    locked: f.is_locked,
    width: f.width,
    height: f.height,
  }));
  const tracking = await repo.listTrackingPoints(t.project_id);
  const seedFrame = decoded[0]?.number ?? start;
  const regionFor = sessionRegion
    ? (frameB: number) =>
        propagateRegionByTrack(
          sessionRegion!,
          seedFrame,
          frameB,
          tracking.map((p) => ({ name: p.name, frame: p.frame_number, x: p.x, y: p.y })),
          { width: decoded[0]?.width ?? 480, height: decoded[0]?.height ?? 270 },
        )
    : undefined;
  const motion = analyzeMotionSequence(
    decoded.map((d) => ({ number: d.number, rgba: d.rgba })),
    { region: sessionRegion, regionFor },
  );
  const poses = decoded.map((d, i) =>
    estimatePoseLite(d.rgba, d.number, {
      prev: i ? decoded[i - 1].rgba : null,
      frameId: d.id,
      characterId: sessionCharacterId,
      region: sessionRegion,
    }),
  );
  const poseEvents = poseContinuity(poses, t.fps);
  const breaks = detectTrackBreaks(
    tracking.map((p) => ({
      name: p.name,
      frame: p.frame_number,
      x: p.x,
      y: p.y,
      status: p.status ?? "visible",
      confidence: p.score,
    })),
  );
  const contacts = detectContactBreaks(tracking);
  const lumas = decoded.map((d) => meanLuma(d.rgba));
  const flicker = decoded.map((d, i) => ({
    frame: d.number,
    score: 1 - Math.min(1, lumaVariance(lumas.slice(Math.max(0, i - 2), i + 3)) * 18),
  }));
  const findings = fuseConsistency({
    motion,
    poseEvents,
    trackBreaks: breaks,
    contacts,
    flicker,
  });
  const charAssign = await repo.listProjectAssignments(t.project_id);
  const byChar = new Map<string, { id: string; name: string; frames: number[] }>();
  for (const a of charAssign) {
    const cur = byChar.get(a.character_id) ?? { id: a.character_id, name: a.name, frames: [] };
    cur.frames.push(a.frame_number);
    byChar.set(a.character_id, cur);
  }
  findings.push(...entityStability([...byChar.values()], [start, end], "CHARACTER_STABILITY", sessionCharacterId));
  const objAssign = await repo.listProjectObjectAssignments(t.project_id);
  const byObj = new Map<string, { id: string; name: string; frames: number[] }>();
  for (const a of objAssign) {
    const cur = byObj.get(a.object_id) ?? { id: a.object_id, name: a.name, frames: [] };
    cur.frames.push(a.frame_number);
    byObj.set(a.object_id, cur);
  }
  findings.push(...entityStability([...byObj.values()], [start, end], "OBJECT_STABILITY"));
  const idOf = (n: number) => decoded.find((d) => d.number === n)?.id ?? null;
  const problems = toProblemFrames(
    findings,
    idOf,
    sessionRegion
      ? { x: sessionRegion.x, y: sessionRegion.y, w: sessionRegion.w, h: sessionRegion.h }
      : null,
  );
  const ranges = mergeProblemRanges(problems);
  snapshotId = await repo.insertContextSnapshot({
    userId: ctx.userId,
    sessionId: typeof args.sessionId === "string" ? args.sessionId : null,
    snapshotJson: JSON.stringify({
      timeline_id: t.id,
      selected_range: [start, end],
      selected_region: sessionRegion,
      selected_character_id: sessionCharacterId,
    }),
    contextVersion: 0,
  });
  await repo.replaceProblemRanges(t.id, ranges, snapshotId);
  const top = ranges[0] ?? null;
  const plan = top
    ? planRepairWindow(
        top,
        decoded.map((d) => ({
          frameNumber: d.number,
          frameType: d.type,
          isLocked: d.locked,
        })),
      )
    : null;
  await persistMotionPairs(t.id, t.project_id, motion, "block-match-16");
  await repo.replacePosesForFrames(
    poses.map((est, i) => ({
      frameId: decoded[i]?.id ?? est.frame_id ?? `missing-${i}`,
      frameNumber: est.frame_number,
      provider: est.provider,
      joints: est.keypoints,
      bbox: est.bbox,
      characterId: est.character_id,
      modelRunId: est.provider,
    })),
  );
  await repo.replaceConsistencyForFrames(
    t.id,
    decoded.map((d) => {
      const fused = fusedFrameScores(findings, d.number);
      return {
        frameId: d.id,
        result: {
          scores: fused.scores,
          severity: fused.severity,
          categories: fused.categories,
          repairWindow: top
            ? ([plan?.repair_range[0] ?? top.start, plan?.repair_range[1] ?? top.end] as [number, number])
            : null,
        },
      };
    }),
  );
  const persistPlan = args.persistPlan !== false;
  let planId: string | null = null;
  if (plan && persistPlan) {
    planId = await repo.insertRepairPlan({
      projectId: t.project_id,
      timelineId: t.id,
      problemStart: plan.problem_range[0],
      problemEnd: plan.problem_range[1],
      repairStart: plan.repair_range[0],
      repairEnd: plan.repair_range[1],
      provider: plan.provider,
      protectedFrames: plan.protected_frames,
      reason: plan.reason,
      createdBy: ctx.caller,
      contextSnapshotId: snapshotId,
    });
  }
  const contextLabel = start !== end ? `F${start}–F${end}` : `F${start}`;
  return buildAssistResponse({
    findings,
    problems,
    ranges,
    plan,
    planId,
    motion,
    contextLabel,
  });
}

export async function getProblemRangesCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const timelineId = String(args.timelineId ?? "");
  if (!timelineId) fail("VALIDATION_ERROR", "timelineId required");
  const t = await repo.getTimeline(timelineId);
  if (!t) fail("FRAME_NOT_FOUND", "Timeline not found", 404);
  await ownProject(ctx, t.project_id);
  const rows = await repo.listProblemRanges(t.id);
  return {
    ranges: rows.map((r) => ({
      id: r.id,
      start: r.start_frame,
      end: r.end_frame,
      peak_frame: r.peak_frame,
      category: r.category,
      severity: r.severity,
      score: r.score,
      reason: r.reason,
    })),
  };
}

export async function createRepairPlanCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const suggested = await suggestRepair(ctx, { ...args, persistPlan: true });
  const plan = suggested.repair_plan;
  if (!plan) {
    return { plan: null, note: "No problem range to plan against." };
  }
  if (suggested.plan_id) {
    return { id: suggested.plan_id, ...plan, assist: suggested };
  }
  const timelineId = String(args.timelineId);
  const t = await repo.getTimeline(timelineId);
  if (!t) fail("FRAME_NOT_FOUND", "Timeline not found", 404);
  const id = await repo.insertRepairPlan({
    projectId: t.project_id,
    timelineId: t.id,
    problemStart: plan.problem_range[0],
    problemEnd: plan.problem_range[1],
    repairStart: plan.repair_range[0],
    repairEnd: plan.repair_range[1],
    provider: plan.provider,
    protectedFrames: plan.protected_frames,
    reason: plan.reason,
    createdBy: ctx.caller,
    contextSnapshotId: await repo.insertContextSnapshot({
      userId: ctx.userId,
      snapshotJson: JSON.stringify({
        timeline_id: t.id,
        problem_range: plan.problem_range,
        repair_range: plan.repair_range,
      }),
      contextVersion: 0,
    }),
  });
  return { id, ...plan, assist: suggested };
}

export async function executeRepairPlanCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const planId = String(args.planId ?? "");
  if (!planId) fail("VALIDATION_ERROR", "planId required");
  const row = await repo.getRepairPlan(planId);
  if (!row) fail("FRAME_NOT_FOUND", "Repair plan not found", 404);
  await ownProject(ctx, row.project_id);
  const providerName = typeof args.provider === "string" ? args.provider : row.provider;
  const interpolator = getInterpolation(providerName);
  if (!interpolator.available()) {
    fail("PROVIDER_NOT_AVAILABLE", `${interpolator.id} is not loaded. Use provider=linear-blend.`);
  }
  const protectedFrames = JSON.parse(row.protected_frames_json || "[]") as number[];
  const plan = {
    problem_range: [row.problem_start, row.problem_end] as [number, number],
    repair_range: [row.repair_start, row.repair_end] as [number, number],
    protected_frames: protectedFrames,
    skipped_locked: [] as number[],
    provider: interpolator.id,
    reason: row.reason,
    interpolation: "FULL_FRAME_INTERPOLATION" as const,
  };
  const interior = interiorRepairFrames(plan);
  const t = await repo.getTimeline(row.timeline_id);
  if (!t) fail("FRAME_NOT_FOUND", "Timeline not found", 404);

  const beforeAssist = await suggestRepair(ctx, {
    timelineId: t.id,
    startFrame: plan.repair_range[0],
    endFrame: plan.repair_range[1],
    persistPlan: false,
    skipJob: true,
  });
  const beforeScores = suggestedScores(beforeAssist);

  const wrapped = await withJob({
    userId: ctx.userId,
    projectId: t.project_id,
    type: "REPAIR_INTERPOLATION",
    payload: { planId, interior, provider: interpolator.id },
    provider: interpolator.id,
    model: interpolator.id,
    work: async (_id, progress) => {
      const a = await repo.getFrameByNumber(t.id, plan.repair_range[0]);
      const b = await repo.getFrameByNumber(t.id, plan.repair_range[1]);
      if (!a || !b) fail("FRAME_NOT_FOUND", "Repair boundary frames missing", 404);
      const ra = decodeJpegBase64(a.image_data);
      const rb = decodeJpegBase64(b.image_data);
      const generated = await interpolator.interpolate(ra, rb, Math.max(1, interior.length), {
        curve: "ease_in_out",
      });
      const repaired: number[] = [];
      const skipped: { frame: number; reason: string }[] = [];
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
      for (const n of interior) {
        const frame = await repo.getFrameByNumber(t.id, n);
        if (!frame) {
          skipped.push({ frame: n, reason: "missing" });
          continue;
        }
        if (frame.is_locked) {
          skipped.push({ frame: n, reason: "locked" });
          continue;
        }
        if (frame.frame_type === "KEY") {
          skipped.push({ frame: n, reason: "keyframe" });
          continue;
        }
        snapshots.push({
          frameId: frame.id,
          frameNumber: n,
          imageData: frame.image_data,
          thumbnailData: frame.thumbnail_data,
          frameType: frame.frame_type,
          durationMs: frame.duration_ms,
          notes: frame.notes,
          contentHash: frame.content_hash,
        });
      }
      const revisionId = await repo.insertRevision({
        projectId: t.project_id,
        frameId: snapshots[0]?.frameId ?? null,
        action: "execute_repair_plan",
        source: ctx.source,
        caller: ctx.caller,
        timelineId: t.id,
        startFrame: plan.repair_range[0],
        endFrame: plan.repair_range[1],
        status: "open",
        previous: { frames: snapshots },
        next: { planId, provider: interpolator.id, interior },
      });
      for (let i = 0; i < snapshots.length; i += 1) {
        const snap = snapshots[i];
        const n = snap.frameNumber;
        const slot = interior.indexOf(n);
        const blended = generated[slot] ?? blendRgba(ra, rb, (i + 1) / (snapshots.length + 1));
        const imageData = encodeJpegBase64(blended, 80);
        const thumbnailData = makeThumbnail(blended);
        const contentHash = hashBytes(imageData);
        await putJpeg(
          t.project_id,
          "originals",
          `orig-F${String(n).padStart(4, "0")}-${snap.contentHash.slice(0, 8)}.jpg`,
          snap.imageData,
        ).catch(() => undefined);
        const originalAsset = `originals/orig-F${String(n).padStart(4, "0")}-${snap.contentHash.slice(0, 8)}.jpg`;
        await putJpeg(
          t.project_id,
          "repaired",
          `F${String(n).padStart(4, "0")}-${contentHash.slice(0, 8)}.jpg`,
          imageData,
        ).catch(() => undefined);
        await repo.insertRevisionFrame({
          revisionId,
          frameId: snap.frameId,
          frameNumber: n,
          previousHash: snap.contentHash,
        });
        await repo.updateFrame(snap.frameId, {
          image_data: imageData,
          thumbnail_data: thumbnailData,
          content_hash: contentHash,
          frame_type: "REPAIRED",
          width: blended.width,
          height: blended.height,
          original_asset: originalAsset,
          active_asset: `repaired/F${String(n).padStart(4, "0")}-${contentHash.slice(0, 8)}.jpg`,
        });
        repaired.push(n);
        await progress(Math.round(((i + 1) / Math.max(1, snapshots.length)) * 80), {
          current: i + 1,
          total: snapshots.length,
          label: "修復插值",
        });
      }
      await repo.updateRepairPlan(planId, { status: "executed", revisionId });
      await progress(90);
      const re = await suggestRepair(ctx, {
        timelineId: t.id,
        startFrame: plan.repair_range[0],
        endFrame: plan.repair_range[1],
        persistPlan: false,
        skipJob: true,
      });
      return {
        repaired,
        skipped,
        revisionId,
        provider: interpolator.id,
        interpolation: "FULL_FRAME_INTERPOLATION",
        before: beforeScores,
        after: suggestedScores(re),
        reanalysis: re,
      };
    },
    summarize: (r) => ({ repaired: r.repaired, provider: r.provider }),
  });
  return { ...wrapped.result, jobId: wrapped.jobId };
}

function suggestedScores(assist: Awaited<ReturnType<typeof suggestRepair>>) {
  const motion = assist.findings.filter((f) => f.type === "MOTION_CONTINUITY");
  const pose = assist.findings.filter((f) => f.type === "POSE_CONTINUITY");
  const track = assist.findings.filter((f) => f.type === "TRACKING_CONTINUITY");
  const contact = assist.findings.filter((f) => f.type === "CONTACT_CONTINUITY");
  const character = assist.findings.filter((f) => f.type === "CHARACTER_STABILITY");
  const object = assist.findings.filter((f) => f.type === "OBJECT_STABILITY");
  return {
    motion: motion.length ? Math.min(...motion.map((m) => m.score)) : null,
    pose: pose.length ? Math.min(...pose.map((m) => m.score)) : null,
    tracking: track.length ? Math.min(...track.map((m) => m.score)) : null,
    contact: contact.length ? Math.min(...contact.map((m) => m.score)) : null,
    character: character.length ? Math.min(...character.map((m) => m.score)) : null,
    object: object.length ? Math.min(...object.map((m) => m.score)) : null,
  };
}

export async function compareBeforeAfter(ctx: CommandContext, args: Record<string, unknown>) {
  const revisionId = String(args.revisionId ?? "");
  if (!revisionId) fail("VALIDATION_ERROR", "revisionId required");
  const rev = await repo.getRevision(revisionId);
  if (!rev) fail("FRAME_NOT_FOUND", "Revision not found", 404);
  await ownProject(ctx, rev.project_id);
  const prev = JSON.parse(rev.previous_json || "{}") as {
    imageData?: string;
    contentHash?: string;
    thumbnailData?: string;
    frames?: Array<{
      frameId: string;
      frameNumber?: number;
      imageData?: string;
      contentHash?: string;
    }>;
  };
  if (Array.isArray(prev.frames) && prev.frames.length) {
    const frames = [];
    for (const f of prev.frames) {
      const current = await repo.getFrame(f.frameId);
      frames.push({
        frameId: f.frameId,
        frameNumber: f.frameNumber ?? current?.frame_number ?? null,
        originalImage: f.imageData ?? null,
        repairedImage: current?.image_data ?? null,
        originalHash: f.contentHash ?? null,
        repairedHash: current?.content_hash ?? null,
      });
    }
    return {
      revisionId,
      frameId: frames[0]?.frameId ?? rev.frame_id,
      frames,
      originalImage: frames[0]?.originalImage ?? null,
      repairedImage: frames[0]?.repairedImage ?? null,
      action: rev.action,
      createdAt: rev.created_at,
      startFrame: rev.start_frame ?? null,
      endFrame: rev.end_frame ?? null,
    };
  }
  const current = rev.frame_id ? await repo.getFrame(rev.frame_id) : null;
  return {
    revisionId,
    frameId: rev.frame_id,
    original: prev.imageData ? { contentHash: prev.contentHash, hasImage: true } : null,
    originalImage: prev.imageData ?? null,
    repairedImage: current?.image_data ?? null,
    repairedHash: current?.content_hash ?? null,
    frames: current
      ? [
          {
            frameId: current.id,
            frameNumber: current.frame_number,
            originalImage: prev.imageData ?? null,
            repairedImage: current.image_data,
          },
        ]
      : [],
    action: rev.action,
    createdAt: rev.created_at,
  };
}

export async function getTrackCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const projectId = String(args.projectId ?? "");
  const name = String(args.name ?? "");
  if (!projectId || !name) fail("VALIDATION_ERROR", "projectId and name required");
  await ownProject(ctx, projectId);
  const pts = (await repo.listTrackingPoints(projectId)).filter((p) => p.name === name);
  return {
    name,
    samples: pts.map((p) => ({
      frame: p.frame_number,
      x: p.x,
      y: p.y,
      visibility: canonicalTrackStatus(p.status ?? "visible") === "VISIBLE" ? 1 : 0,
      confidence: p.score,
      status: canonicalTrackStatus(p.status ?? "visible"),
    })),
  };
}

export async function getRepairPlanCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const planId = String(args.planId ?? "");
  if (!planId) fail("VALIDATION_ERROR", "planId required");
  const row = await repo.getRepairPlan(planId);
  if (!row) fail("FRAME_NOT_FOUND", "Repair plan not found", 404);
  await ownProject(ctx, row.project_id);
  return {
    id: row.id,
    problem_range: [row.problem_start, row.problem_end],
    repair_range: [row.repair_start, row.repair_end],
    provider: row.provider,
    protected_frames: JSON.parse(row.protected_frames_json || "[]"),
    reason: row.reason,
    status: row.status,
    revision_id: row.revision_id,
  };
}

export async function acceptRevisionCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const revisionId = String(args.revisionId ?? "");
  if (!revisionId) fail("VALIDATION_ERROR", "revisionId required");
  const rev = await repo.getRevision(revisionId);
  if (!rev) fail("FRAME_NOT_FOUND", "Revision not found", 404);
  await ownProject(ctx, rev.project_id);
  await repo.updateRevisionStatus(revisionId, "accepted");
  return { id: revisionId, status: "accepted" };
}

void loadSlice;
