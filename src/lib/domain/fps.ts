/** Playback clock vs drawing exposure. Never default a pipeline to 12fps. */

export const PRESET_FPS = [12, 24, 30] as const;
export const DEFAULT_PLAYBACK_FPS = 24;
export const MIN_FPS = 1;
export const MAX_FPS = 60;
export const MIN_EXPOSURE = 1;
export const MAX_EXPOSURE = 4;

export function clampFps(n: number, fallback = DEFAULT_PLAYBACK_FPS): number {
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(MIN_FPS, Math.min(MAX_FPS, Math.round(n)));
}

export function clampExposure(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return MIN_EXPOSURE;
  return Math.max(MIN_EXPOSURE, Math.min(MAX_EXPOSURE, Math.round(n)));
}

/** Snap broadcast fractions onto animation-friendly integers. */
export function normalizeSourceFps(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_PLAYBACK_FPS;
  if (Math.abs(raw - 23.976) < 0.08 || Math.abs(raw - 23.98) < 0.08) return 24;
  if (Math.abs(raw - 29.97) < 0.08) return 30;
  if (Math.abs(raw - 59.94) < 0.08) return 60;
  return clampFps(raw);
}

export function parseFpsField(
  raw: string | number | null | undefined,
): number | "auto" {
  if (raw == null) return "auto";
  const s = String(raw).trim().toLowerCase();
  if (s === "" || s === "auto" || s === "source" || s === "0") return "auto";
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return "auto";
  return clampFps(n);
}

export function resolveExtractFps(
  requested: number | "auto" | string | undefined,
  sourceFps: number,
): number {
  const parsed = typeof requested === "number" ? (requested <= 0 ? "auto" : requested) : parseFpsField(requested);
  if (parsed === "auto") return clampFps(sourceFps);
  return clampFps(parsed, sourceFps);
}

export function resolvePlaybackFps(
  requested: number | "same" | string | undefined,
  extractFps: number,
): number {
  if (requested == null) return extractFps;
  const s = String(requested).trim().toLowerCase();
  if (s === "" || s === "same" || s === "auto") return extractFps;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return extractFps;
  return clampFps(n, extractFps);
}

/** Hold length of one drawing on the playback clock. Independent of extract fps. */
export function frameDurationMs(playbackFps: number, exposureCount = 1): number {
  const fps = clampFps(playbackFps);
  const exp = clampExposure(exposureCount);
  return Math.max(1, Math.round((1000 / fps) * exp));
}

export type VideoProbeMeta = {
  fps: number;
  durationMs: number;
  width: number;
  height: number;
};

export function parseFfmpegVideoMeta(stderr: string): VideoProbeMeta {
  const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  let durationMs = 0;
  if (durationMatch) {
    const h = Number(durationMatch[1]);
    const m = Number(durationMatch[2]);
    const s = Number(durationMatch[3]);
    durationMs = Math.round(((h * 3600) + (m * 60) + s) * 1000);
  }
  const videoLine =
    stderr.split("\n").find((line) => /Stream #.*Video:/i.test(line)) ?? stderr;
  const dim = videoLine.match(/(\d{2,5})x(\d{2,5})/);
  const fpsMatch =
    videoLine.match(/([\d.]+)\s*fps/i) ??
    videoLine.match(/([\d.]+)\s*tbr/i) ??
    stderr.match(/([\d.]+)\s*fps/i);
  const ratio = videoLine.match(/(\d+)\s*\/\s*(\d+)\s*fps/);
  let fps = DEFAULT_PLAYBACK_FPS;
  if (ratio) {
    const a = Number(ratio[1]);
    const b = Number(ratio[2]);
    if (b > 0) fps = normalizeSourceFps(a / b);
  } else if (fpsMatch) {
    fps = normalizeSourceFps(Number(fpsMatch[1]));
  }
  return {
    fps,
    durationMs,
    width: dim ? Number(dim[1]) : 0,
    height: dim ? Number(dim[2]) : 0,
  };
}
