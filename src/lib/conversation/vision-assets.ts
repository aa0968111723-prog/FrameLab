/** Build small JPEG previews for vision models. Never ship 4K frames. */

import { decodeJpegBase64, encodeJpegBase64 } from "@/lib/domain/image-codec";
import {
  paddedNormalizedRegion,
  pixelsFromNormalized,
  type RegionSelection,
} from "@/lib/domain/context-engine";
import { downsample } from "@/lib/domain/pixel-metrics";
import { cropRgba } from "@/lib/domain/lightweight-analysis";
import type { LLMImage } from "@/lib/ai/llm-provider";

const CACHE_MAX = 24;
const visionCache = new Map<string, LLMImage>();

function cacheKey(parts: unknown[]): string {
  return parts.map((p) => (typeof p === "string" ? p.slice(0, 48) : JSON.stringify(p))).join("|");
}

function cacheGet(key: string): LLMImage | null {
  return visionCache.get(key) ?? null;
}

function cacheSet(key: string, img: LLMImage) {
  if (visionCache.has(key)) visionCache.delete(key);
  visionCache.set(key, img);
  while (visionCache.size > CACHE_MAX) {
    const oldest = visionCache.keys().next().value;
    if (oldest == null) break;
    visionCache.delete(oldest);
  }
}

export function clearVisionCache() {
  visionCache.clear();
}

export function visionJpeg(
  imageBase64: string,
  label: string,
  maxW = 512,
  maxH = 512,
): LLMImage | null {
  if (!imageBase64) return null;
  const key = cacheKey(["jpeg", label, maxW, maxH, imageBase64.length, imageBase64.slice(0, 64)]);
  const hit = cacheGet(key);
  if (hit) return { ...hit, label };
  try {
    const raw = decodeJpegBase64(imageBase64);
    const small = downsample(raw, maxW, maxH);
    const img: LLMImage = {
      mimeType: "image/jpeg",
      base64: encodeJpegBase64(small, 0.72),
      label,
    };
    cacheSet(key, img);
    return img;
  } catch {
    return null;
  }
}

export function visionCrop(
  imageBase64: string,
  region: RegionSelection,
  frameWidth: number,
  frameHeight: number,
  label = "selected region",
): LLMImage | null {
  if (!imageBase64) return null;
  const key = cacheKey([
    "crop",
    label,
    region.x,
    region.y,
    region.width,
    region.height,
    frameWidth,
    frameHeight,
    imageBase64.length,
    imageBase64.slice(0, 64),
  ]);
  const hit = cacheGet(key);
  if (hit) return { ...hit, label };
  try {
    const raw = decodeJpegBase64(imageBase64);
    const padded = paddedNormalizedRegion(region, 0.15);
    const box = pixelsFromNormalized(padded, frameWidth, frameHeight);
    const crop = cropRgba(raw, box);
    const small = downsample(crop, 384, 384);
    const img: LLMImage = {
      mimeType: "image/jpeg",
      base64: encodeJpegBase64(small, 0.72),
      label,
    };
    cacheSet(key, img);
    return img;
  } catch {
    return null;
  }
}

export function buildVisionAssets(input: {
  currentJpeg?: string;
  currentLabel?: string;
  region?: RegionSelection | null;
  frameWidth?: number;
  frameHeight?: number;
  neighborJpegs?: { label: string; jpeg: string }[];
}): LLMImage[] {
  const out: LLMImage[] = [];
  if (input.currentJpeg) {
    const full = visionJpeg(input.currentJpeg, input.currentLabel ?? "current frame", 448, 448);
    if (full) out.push(full);
  }
  if (input.region && input.currentJpeg && input.frameWidth && input.frameHeight) {
    const crop = visionCrop(
      input.currentJpeg,
      input.region,
      input.frameWidth,
      input.frameHeight,
    );
    if (crop) out.push(crop);
  }
  for (const n of (input.neighborJpegs ?? []).slice(0, 2)) {
    const im = visionJpeg(n.jpeg, n.label, 256, 256);
    if (im) out.push(im);
  }
  return out.slice(0, 4);
}

export const VisionAssetBuilder = {
  jpeg: visionJpeg,
  crop: visionCrop,
  build: buildVisionAssets,
  clearCache: clearVisionCache,
};
