/** Region repair: selection → mask → temporal context → candidate → before/after. Never bbox-blend as AI. */

import { getGenerativeRepair } from "@/lib/ai/providers";
import { fail } from "@/lib/domain/errors";
import { cropRgba } from "@/lib/domain/lightweight-analysis";
import { decodeJpegBase64, encodeJpegBase64, hashBytes, makeThumbnail } from "@/lib/domain/image-codec";
import { blendRgba } from "@/lib/domain/pixel-metrics";
import {
  buildRegionRepairPipeline,
  isNeighborhoodPreview,
  maskFromSelection,
  maskToPixels,
  neighborhoodPreviewNote,
  regionRepairUnavailableMessage,
  usableBox,
  type RegionMask,
} from "@/lib/domain/region-repair";
import * as repo from "@/lib/framelab/repo";
import { ownTimeline } from "./ownership.ts";
import { withJob } from "@/lib/jobs/queue";
import type { CommandContext } from "./execute.ts";

function num(v: unknown, fallback = Number.NaN): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

async function loadFrame(ctx: CommandContext, args: Record<string, unknown>) {
  if (typeof args.frameId === "string" && args.frameId) {
    const frame = await repo.getFrame(args.frameId);
    if (!frame) fail("FRAME_NOT_FOUND", "Frame not found", 404);
    await ownTimeline(ctx, frame.timeline_id);
    return frame;
  }
  const timelineId = String(args.timelineId ?? "");
  if (!timelineId) fail("VALIDATION_ERROR", "frameId or timelineId required");
  const t = await ownTimeline(ctx, timelineId);
  const n = num(args.frameNumber);
  if (!Number.isFinite(n)) fail("VALIDATION_ERROR", "frameNumber required");
  const frame = await repo.getFrameByNumber(t.id, n);
  if (!frame) fail("FRAME_NOT_FOUND", "Frame not found", 404);
  return frame;
}

async function resolveMask(
  frame: repo.FrameRow,
  args: Record<string, unknown>,
): Promise<RegionMask | null> {
  const x = num(args.x);
  const y = num(args.y);
  const w = num(args.w);
  const h = num(args.h);
  const box =
    Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h)
      ? { x, y, w, h }
      : null;
  const fromBox = maskFromSelection(frame.frame_number, box);
  const segs = await repo.listSegmentations(frame.timeline_id);
  const hit = segs.find((s) => s.frame_id === frame.id && s.status !== "lost");
  if (hit) {
    let bbox = { x: 0, y: 0, w: 0, h: 0 };
    let contour: number[][] = [];
    try {
      bbox = JSON.parse(hit.bbox_json) as typeof bbox;
    } catch {
      /* ignore */
    }
    try {
      contour = JSON.parse(hit.contour_json) as number[][];
    } catch {
      /* ignore */
    }
    if (usableBox(bbox, 0.002)) {
      return {
        frame: frame.frame_number,
        ...bbox,
        contour,
        confidence: hit.confidence ?? hit.score ?? undefined,
        status: hit.status,
        source: hit.provider === "sam2" ? "sam2" : "rectangle",
      };
    }
  }
  return fromBox;
}

export async function repairRegionCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const frame = await loadFrame(ctx, args);
  const t = await ownTimeline(ctx, frame.timeline_id);
  const method = String(args.method ?? "generative");
  const providerId = String(args.provider ?? "wan");
  const frames = await repo.listFramesFull(t.id);
  const mask = await resolveMask(frame, args);
  const selection = usableBox({ w: num(args.w, 0), h: num(args.h, 0) })
    ? { x: num(args.x, 0), y: num(args.y, 0), w: num(args.w, 0), h: num(args.h, 0) }
    : mask
      ? { x: mask.x, y: mask.y, w: mask.w, h: mask.h }
      : null;
  if (!mask) fail("VALIDATION_ERROR", "需要選區或 SAM 2 遮罩。矩形混合不是 AI 修復。");

  const preview = isNeighborhoodPreview(method);
  const gen = preview ? null : getGenerativeRepair(providerId);
  const available = preview ? true : Boolean(gen?.available());
  const pipeline = buildRegionRepairPipeline({
    frameNumber: frame.frame_number,
    selection,
    mask,
    frameNumbers: frames.map((f) => f.frame_number),
    providerId: preview ? "neighborhood-preview" : providerId,
    providerAvailable: available,
  });

  if (!preview) {
    if (!gen || !gen.available()) {
      fail("PROVIDER_NOT_AVAILABLE", regionRepairUnavailableMessage(providerId));
    }
    const wrapped = await withJob({
      userId: ctx.userId,
      projectId: t.project_id,
      type: "GENERATIVE_REPAIR",
      payload: { frameId: frame.id, provider: providerId },
      provider: providerId,
      model: providerId,
      work: async () => {
        const run = await gen.regenerateRegion();
        if (!run.ok) {
          fail(run.code, run.error);
        }
        return run;
      },
      summarize: () => ({ provider: providerId }),
    });
    return {
      ...pipeline,
      available: true,
      ai: true,
      jobId: wrapped.jobId,
      pixelsChanged: false,
      note: "生成修復候選。尚未寫入時間軸。",
    };
  }

  const prev = await repo.getFrameByNumber(t.id, frame.frame_number - 1);
  const next = await repo.getFrameByNumber(t.id, frame.frame_number + 1);
  if (!prev?.image_data || !next?.image_data || !frame.image_data) {
    fail("FRAME_ASSET_UNAVAILABLE", "快速預覽需要前後影格。不是 AI 修復。");
  }
  const box = maskToPixels(mask, frame.width, frame.height);
  const a = decodeJpegBase64(prev.image_data);
  const b = decodeJpegBase64(next.image_data);
  const mid = blendRgba(a, b, 0.5);
  const base = decodeJpegBase64(frame.image_data);
  const patch = cropRgba(mid, box);
  for (let row = 0; row < patch.height; row += 1) {
    for (let col = 0; col < patch.width; col += 1) {
      const di = ((Math.round(box.y) + row) * base.width + (Math.round(box.x) + col)) * 4;
      const si = (row * patch.width + col) * 4;
      if (di < 0 || di + 3 >= base.data.length) continue;
      base.data[di] = patch.data[si];
      base.data[di + 1] = patch.data[si + 1];
      base.data[di + 2] = patch.data[si + 2];
      base.data[di + 3] = 255;
    }
  }
  const imageData = encodeJpegBase64(base, 80);
  const thumbnailData = makeThumbnail(base);
  const contentHash = hashBytes(imageData);
  const candidateId = await repo.insertCandidate({
    projectId: t.project_id,
    timelineId: t.id,
    provider: "neighborhood-preview",
    model: "neighborhood-preview",
    quality: "preview",
    status: "ready",
    framesJson: JSON.stringify([
      {
        frameNumber: frame.frame_number,
        imageData,
        thumbnailData,
        contentHash,
        width: base.width,
        height: base.height,
        motion_progress: 0.5,
        generated_from_start: prev.frame_number,
        generated_from_end: next.frame_number,
        provider: "neighborhood-preview",
        model: "neighborhood-preview",
      },
    ]),
    evaluationJson: JSON.stringify({ note: neighborhoodPreviewNote() }),
  });
  return {
    ...buildRegionRepairPipeline({
      frameNumber: frame.frame_number,
      selection,
      mask,
      frameNumbers: frames.map((f) => f.frame_number),
      providerId: "neighborhood-preview",
      providerAvailable: true,
      candidateId,
    }),
    candidateId,
    provider: "neighborhood-preview",
    ai: false,
    available: true,
    pixelsChanged: false,
    note: neighborhoodPreviewNote(),
    beforeImage: `data:image/jpeg;base64,${frame.image_data}`,
    afterImage: `data:image/jpeg;base64,${imageData}`,
    frameNumber: frame.frame_number,
  };
}
