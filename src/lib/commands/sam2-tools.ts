/** SAM 2 click → real mask + forward/backward propagate. Never fakes success. */

import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fail } from "@/lib/domain/errors";
import { projectRoot } from "@/lib/storage/local";
import { sam2Available, sam2Health, runSam2 } from "@/lib/ai/sam2-worker";
import * as repo from "@/lib/framelab/repo";
import { ownTimeline } from "./ownership.ts";
import { withJob } from "@/lib/jobs/queue";
import type { CommandContext } from "./execute.ts";

function num(v: unknown, fallback = Number.NaN): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export async function listSegmentationsCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const timelineId = String(args.timelineId ?? "");
  if (!timelineId) fail("VALIDATION_ERROR", "timelineId required");
  const t = await ownTimeline(ctx, timelineId);
  const rows = await repo.listSegmentations(t.id);
  const frameNumber = num(args.frameNumber);
  const objectId = typeof args.objectId === "string" ? args.objectId : "";
  const filtered = rows.filter((r) => {
    if (Number.isFinite(frameNumber) && r.frame_number !== frameNumber) return false;
    if (objectId && r.object_id !== objectId) return false;
    return true;
  });
  return {
    masks: filtered.map((r) => ({
      id: r.id,
      frame_id: r.frame_id,
      frame_number: r.frame_number,
      object_id: r.object_id,
      bbox: jsonObj(r.bbox_json),
      contour: jsonArr(r.contour_json),
      score: r.score,
      confidence: r.confidence,
      status: r.status,
      area: r.area,
      warning: r.warning,
      provider: r.provider,
    })),
  };
}

function jsonObj(raw: string) {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
function jsonArr(raw: string) {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function segmentObjectCmd(ctx: CommandContext, args: Record<string, unknown>) {
  const timelineId = String(args.timelineId ?? "");
  const t = await ownTimeline(ctx, timelineId);
  if (!sam2Available()) {
    const h = sam2Health();
    fail("MODEL_NOT_AVAILABLE", h.error || "SAM 2 worker is not loaded. No fake mask.");
  }
  const x = num(args.x);
  const y = num(args.y);
  const frameNumber = num(args.frameNumber);
  if (!Number.isFinite(x) || !Number.isFinite(y)) fail("VALIDATION_ERROR", "x and y required");
  if (!Number.isFinite(frameNumber)) fail("VALIDATION_ERROR", "frameNumber required");
  const directionRaw = String(args.direction ?? "both");
  const direction =
    directionRaw === "forward" || directionRaw === "backward" ? directionRaw : "both";
  const objectId = String(
    args.objectId || args.characterId || args.name || `click-F${frameNumber}`,
  );
  const frames = await repo.listFramesFull(t.id);
  if (!frames.length) fail("FRAME_NOT_FOUND", "No frames", 404);
  const start = Number.isFinite(num(args.startFrame)) ? num(args.startFrame) : frames[0]!.frame_number;
  const end = Number.isFinite(num(args.endFrame))
    ? num(args.endFrame)
    : frames[frames.length - 1]!.frame_number;
  const slice = frames.filter((f) => f.frame_number >= start && f.frame_number <= end);
  const wrapped = await withJob({
    userId: ctx.userId,
    projectId: t.project_id,
    type: "SEGMENTATION",
    payload: { timelineId: t.id, frameNumber, provider: "sam2", direction },
    provider: "sam2",
    model: "sam2.1-hiera-tiny",
    work: async (_id, progress) => {
      await progress(8, { current: 0, total: slice.length, label: "載入 SAM 2" });
      const dir = path.join(tmpdir(), "framelab-sam2", String(Date.now()));
      await mkdir(dir, { recursive: true });
      const inputs: { id: string; path: string; frameNumber: number; width?: number; height?: number }[] = [];
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
          }
          inputs.push({
            id: f.id,
            path: file,
            frameNumber: f.frame_number,
            width: f.width,
            height: f.height,
          });
        }
        if (!inputs.length) fail("FRAME_ASSET_UNAVAILABLE", "No frame images for SAM 2");
        await progress(20, { current: 0, total: inputs.length, label: "SAM 2 推論" });
        const out = await runSam2({
          frames: inputs,
          click: { x, y, frameNumber, label: 1 },
          objectId,
          direction,
        });
        await progress(85, { current: out.masks.length, total: inputs.length, label: "寫入遮罩" });
        const byNumber = new Map(slice.map((f) => [f.frame_number, f]));
        await repo.replaceSegmentationsForObject(
          out.masks
            .map((m) => {
              const frame = byNumber.get(m.frameNumber);
              if (!frame) return null;
              return {
                frameId: frame.id,
                frameNumber: m.frameNumber,
                provider: "sam2",
                objectId: out.objectId,
                bbox: m.bbox,
                contour: m.contour,
                score: m.score,
                confidence: m.confidence,
                status: m.status,
                area: m.area,
                direction: m.direction ?? null,
                warning: m.warning ?? null,
                modelRunId: out.model,
              };
            })
            .filter((r): r is NonNullable<typeof r> => Boolean(r)),
        );
        return out;
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
    summarize: (r) => ({
      masks: r.masks.length,
      provider: "sam2",
      degraded: r.degraded,
      warnings: r.warnings.length,
    }),
  });
  return {
    ...wrapped.result,
    jobId: wrapped.jobId,
    pixelsChanged: false,
  };
}
