import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fail } from "../domain/errors.ts";
import {
  decodeJpegBuffer,
  encodeJpegBuffer,
  hashBuffer,
  scaleRgba,
} from "../domain/image-codec.ts";
import { assertInsideData, ensureProjectLayout, projectRoot } from "./local.ts";

export const ASSET_TIERS = ["full", "preview", "thumbnail"] as const;
export type AssetTier = (typeof ASSET_TIERS)[number];

export const PREVIEW_MAX = 480;
export const THUMB_MAX_W = 96;
export const THUMB_MAX_H = 54;

/** Inline JPEG base64 is long; asset paths are short `frames/...` relatives. */
export function isInlineJpeg(s?: string | null): boolean {
  if (!s || s.length < 80) return false;
  if (s.startsWith("frames/") || s.startsWith("/api/") || s.startsWith("data:")) return false;
  return true;
}

export function frameAssetRel(tier: AssetTier, frameNumber: number, hash: string): string {
  const pad = String(Math.max(0, Math.round(frameNumber))).padStart(6, "0");
  const dir = tier === "thumbnail" ? "thumb" : tier;
  const short = hash.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "asset";
  return `frames/${dir}/F${pad}-${short}.jpg`;
}

export function frameAssetUrl(frameId: string, tier: AssetTier, version?: string): string {
  const q = new URLSearchParams({ frameId, tier });
  if (version) q.set("v", version);
  return `/api/frame-assets?${q.toString()}`;
}

export async function writeProjectRel(projectId: string, rel: string, bytes: Buffer): Promise<string> {
  if (!rel || rel.includes("..") || path.isAbsolute(rel) || rel.startsWith("/")) {
    fail("STORAGE_ERROR", "Invalid asset path");
  }
  await ensureProjectLayout(projectId);
  const full = assertInsideData(path.join(projectRoot(projectId), rel));
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes);
  return rel;
}

export async function readProjectRel(projectId: string, rel: string): Promise<Buffer> {
  if (!rel || rel.includes("..") || path.isAbsolute(rel) || rel.startsWith("/")) {
    fail("STORAGE_ERROR", "Invalid asset path");
  }
  return readFile(assertInsideData(path.join(projectRoot(projectId), rel)));
}

export type FrameAssetPaths = {
  full_asset: string;
  preview_asset: string;
  thumbnail_asset: string;
  width: number;
  height: number;
  content_hash: string;
};

export async function writeFrameAssets(input: {
  projectId: string;
  frameNumber: number;
  jpeg: Buffer;
}): Promise<FrameAssetPaths> {
  const rgba = decodeJpegBuffer(input.jpeg);
  const hash = hashBuffer(input.jpeg);
  const previewJpeg = encodeJpegBuffer(scaleRgba(rgba, PREVIEW_MAX, PREVIEW_MAX), 72);
  const thumbJpeg = encodeJpegBuffer(scaleRgba(rgba, THUMB_MAX_W, THUMB_MAX_H), 62);
  const full_asset = frameAssetRel("full", input.frameNumber, hash);
  const preview_asset = frameAssetRel("preview", input.frameNumber, hash);
  const thumbnail_asset = frameAssetRel("thumbnail", input.frameNumber, hash);
  await writeProjectRel(input.projectId, full_asset, input.jpeg);
  await writeProjectRel(input.projectId, preview_asset, previewJpeg);
  await writeProjectRel(input.projectId, thumbnail_asset, thumbJpeg);
  return {
    full_asset,
    preview_asset,
    thumbnail_asset,
    width: rgba.width,
    height: rgba.height,
    content_hash: hash,
  };
}

export async function readFrameAssetBase64(projectId: string, rel: string): Promise<string> {
  const buf = await readProjectRel(projectId, rel);
  return buf.toString("base64");
}
