/** True animation exposure: one drawing occupies N playback ticks. Never duplicate the image. */

import { clampExposure, MAX_EXPOSURE, MIN_EXPOSURE, tickDurationMs } from "./fps.ts";

export const EXPOSURE_PRESETS = [1, 2, 3] as const;
export type ExposurePreset = (typeof EXPOSURE_PRESETS)[number];

export const EXPOSURE_LABEL: Record<number, string> = {
  1: "一拍一",
  2: "一拍二",
  3: "一拍三",
  4: "一拍四",
};

export function exposureTicks(count: number | undefined | null): number {
  return clampExposure(count ?? 1);
}

export function exposureLabel(count: number | undefined | null): string {
  const n = exposureTicks(count);
  return EXPOSURE_LABEL[n] ?? `一拍${n}`;
}

export { tickDurationMs };

export type PlaybackDrawing = {
  id: string;
  frameNumber?: number;
  exposureCount?: number | null;
};

export type PlaybackSlot = {
  tick: number;
  drawingId: string;
  drawingIndex: number;
  frameNumber: number;
  localTick: number;
  exposure: number;
};

export type ExposureCell = {
  id: string;
  frameNumber: number;
  drawingIndex: number;
  startTick: number;
  ticks: number;
  left: number;
  width: number;
};

export function expandPlaybackSlots(drawings: PlaybackDrawing[]): PlaybackSlot[] {
  const slots: PlaybackSlot[] = [];
  let tick = 0;
  drawings.forEach((d, drawingIndex) => {
    const exposure = exposureTicks(d.exposureCount);
    const frameNumber = d.frameNumber ?? drawingIndex;
    for (let localTick = 0; localTick < exposure; localTick += 1) {
      slots.push({
        tick,
        drawingId: d.id,
        drawingIndex,
        frameNumber,
        localTick,
        exposure,
      });
      tick += 1;
    }
  });
  return slots;
}

export function playbackLength(drawings: PlaybackDrawing[]): number {
  return drawings.reduce((n, d) => n + exposureTicks(d.exposureCount), 0);
}

export function drawingAtTick(
  drawings: PlaybackDrawing[],
  tick: number,
): PlaybackSlot | null {
  const slots = expandPlaybackSlots(drawings);
  if (slots.length === 0) return null;
  const t = Math.min(slots.length - 1, Math.max(0, Math.floor(tick)));
  return slots[t] ?? null;
}

export function startTickOfDrawing(drawings: PlaybackDrawing[], frameNumber: number): number {
  let tick = 0;
  for (const d of drawings) {
    if ((d.frameNumber ?? -1) === frameNumber) return tick;
    tick += exposureTicks(d.exposureCount);
  }
  return 0;
}

export function tickRangeForDrawings(
  drawings: PlaybackDrawing[],
  startFrame: number,
  endFrame: number,
): { startTick: number; endTick: number } {
  const a = Math.min(startFrame, endFrame);
  const b = Math.max(startFrame, endFrame);
  let tick = 0;
  let startTick = 0;
  let endTick = 0;
  let found = false;
  for (const d of drawings) {
    const n = d.frameNumber ?? 0;
    const span = exposureTicks(d.exposureCount);
    if (n >= a && n <= b) {
      if (!found) {
        startTick = tick;
        found = true;
      }
      endTick = tick + span - 1;
    }
    tick += span;
  }
  return { startTick, endTick };
}

export function layoutExposureStrip(
  drawings: PlaybackDrawing[],
  cellWidth: number,
): { cells: ExposureCell[]; totalTicks: number; totalWidth: number } {
  const cell = Math.max(1, cellWidth);
  const cells: ExposureCell[] = [];
  let tick = 0;
  drawings.forEach((d, drawingIndex) => {
    const ticks = exposureTicks(d.exposureCount);
    cells.push({
      id: d.id,
      frameNumber: d.frameNumber ?? drawingIndex,
      drawingIndex,
      startTick: tick,
      ticks,
      left: tick * cell,
      width: ticks * cell,
    });
    tick += ticks;
  });
  return { cells, totalTicks: tick, totalWidth: tick * cell };
}

export function drawingAtX(
  drawings: PlaybackDrawing[],
  x: number,
  cellWidth: number,
): number {
  const { cells, totalWidth } = layoutExposureStrip(drawings, cellWidth);
  if (cells.length === 0) return 0;
  const px = Math.min(totalWidth - 1, Math.max(0, x));
  const hit = cells.find((c) => px >= c.left && px < c.left + c.width);
  return hit?.frameNumber ?? cells[cells.length - 1]!.frameNumber;
}

export { MIN_EXPOSURE, MAX_EXPOSURE };
