/** Preview must actually shrink pixels. Production keeps source size. */

import type { RgbaFrame } from "./pixel-metrics.ts";

export type GenerationQuality = "preview" | "production" | "custom";

export type GenerationSize = {
  width: number;
  height: number;
  jpegQ: number;
  scale: number;
};

const PREVIEW_MAX_WIDTH = 960;

export function resolveGenerationSize(
  src: { width: number; height: number },
  quality: GenerationQuality,
  custom?: { width?: number; height?: number },
): GenerationSize {
  if (quality === "production") {
    return { width: src.width, height: src.height, jpegQ: 88, scale: 1 };
  }
  if (quality === "custom" && custom?.width && custom?.height) {
    const scale = custom.width / Math.max(1, src.width);
    return { width: custom.width, height: custom.height, jpegQ: 80, scale };
  }
  if (src.width <= PREVIEW_MAX_WIDTH) {
    return { width: src.width, height: src.height, jpegQ: 72, scale: 1 };
  }
  const scale = PREVIEW_MAX_WIDTH / src.width;
  return {
    width: Math.max(1, Math.round(src.width * scale)),
    height: Math.max(1, Math.round(src.height * scale)),
    jpegQ: 72,
    scale,
  };
}

/** Nearest-neighbor resize. Honest, no invented detail. */
export function downscaleRgba(frame: RgbaFrame, width: number, height: number): RgbaFrame {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (frame.width === w && frame.height === h) return frame;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(frame.height - 1, Math.floor((y * frame.height) / h));
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(frame.width - 1, Math.floor((x * frame.width) / w));
      const si = (sy * frame.width + sx) * 4;
      const di = (y * w + x) * 4;
      data[di] = frame.data[si]!;
      data[di + 1] = frame.data[si + 1]!;
      data[di + 2] = frame.data[si + 2]!;
      data[di + 3] = frame.data[si + 3] ?? 255;
    }
  }
  return { data, width: w, height: h };
}
