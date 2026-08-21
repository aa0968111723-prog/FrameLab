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

/** One playback tick at this fps. Exposure multiplies this; never duplicate drawings. */
export function tickDurationMs(playbackFps: number): number {
  return Math.max(1, Math.round(1000 / clampFps(playbackFps)));
}

/** Hold length of one drawing on the playback clock. Independent of extract fps. */
export function frameDurationMs(playbackFps: number, exposureCount = 1): number {
  return tickDurationMs(playbackFps) * clampExposure(exposureCount);
}

/** Native-extract fallback when the container did not advertise a rate. */
export function inferFpsFromCount(frameCount: number, durationMs: number): number {
  if (!Number.isFinite(frameCount) || frameCount <= 1) return 0;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return normalizeSourceFps(frameCount / (durationMs / 1000));
}

export type VideoProbeMeta = {
  fps: number;
  durationMs: number;
  width: number;
  height: number;
  fpsFound: boolean;
};

function plausibleRate(n: number): boolean {
  return Number.isFinite(n) && n > 0 && n <= MAX_FPS + 5;
}

function pickRawFps(videoLine: string, stderr: string): { raw: number; found: boolean } {
  const ratio = videoLine.match(/(\d+)\s*\/\s*(\d+)\s*(?:fps|tbr)/i);
  if (ratio) {
    const a = Number(ratio[1]);
    const b = Number(ratio[2]);
    if (b > 0 && plausibleRate(a / b)) return { raw: a / b, found: true };
  }
  const fpsMatch =
    videoLine.match(/(?<![/\d])([\d.]+)\s*fps/i) ?? stderr.match(/(?<![/\d])([\d.]+)\s*fps/i);
  if (fpsMatch) {
    const n = Number(fpsMatch[1]);
    if (plausibleRate(n)) return { raw: n, found: true };
  }
  const tbr = videoLine.match(/([\d.]+)\s*tbr(?!\w)/i);
  if (tbr) {
    const n = Number(tbr[1]);
    if (plausibleRate(n)) return { raw: n, found: true };
  }
  return { raw: 0, found: false };
}

export function parseFfmpegVideoMeta(stderr: string): VideoProbeMeta {
  const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  let durationMs = 0;
  if (durationMatch) {
    const h = Number(durationMatch[1]);
    const m = Number(durationMatch[2]);
    const s = Number(durationMatch[3]);
    durationMs = Math.round((h * 3600 + m * 60 + s) * 1000);
  }
  const videoLine =
    stderr.split("\n").find((line) => /Stream #.*Video:/i.test(line)) ?? stderr;
  const dim = videoLine.match(/(\d{2,5})x(\d{2,5})/);
  const picked = pickRawFps(videoLine, stderr);
  return {
    fps: picked.found ? normalizeSourceFps(picked.raw) : DEFAULT_PLAYBACK_FPS,
    durationMs,
    width: dim ? Number(dim[1]) : 0,
    height: dim ? Number(dim[2]) : 0,
    fpsFound: picked.found,
  };
}
