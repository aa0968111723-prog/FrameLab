import { DEFAULT_PLAYBACK_FPS, clampFps } from "@/lib/domain/fps";

export type ExtractedJpeg = {
  frameNumber: number;
  imageData: string;
  width: number;
  height: number;
};

/** Max JPEGs in one HTTP ingest body. Thousands of frames go in successive chunks. */
export const INGEST_HTTP_BATCH = 32;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function waitSeeked(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const on = () => {
      video.removeEventListener("seeked", on);
      video.removeEventListener("error", err);
      resolve();
    };
    const err = () => {
      video.removeEventListener("seeked", on);
      video.removeEventListener("error", err);
      reject(new Error("seek failed"));
    };
    video.addEventListener("seeked", on);
    video.addEventListener("error", err);
  });
}

async function rasterToJpeg(
  source: CanvasImageSource,
  width: number,
  height: number,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  frameNumber: number,
): Promise<ExtractedJpeg | null> {
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(source, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82),
  );
  if (!blob) return null;
  return { frameNumber, imageData: await blobToBase64(blob), width, height };
}

function scaledSize(srcW: number, srcH: number, maxW: number) {
  const scale = Math.min(1, maxW / (srcW || maxW));
  const width = Math.max(2, Math.round((srcW || 480) * scale) & ~1);
  const height = Math.max(2, Math.round((srcH || 270) * scale) & ~1);
  return { width, height };
}

export async function extractVideoFrames(
  file: File,
  opts: {
    fps: number;
    maxFrames?: number;
    maxWidth?: number;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<ExtractedJpeg[]> {
  const frames: ExtractedJpeg[] = [];
  await extractVideoFrameBatches(file, opts, async (batch) => {
    frames.push(...batch);
  });
  return frames;
}

/** Decode a video in the browser and yield JPEG batches. No demo frame cap. */
export async function extractVideoFrameBatches(
  file: File,
  opts: {
    fps: number;
    maxFrames?: number;
    maxWidth?: number;
    onProgress?: (done: number, total: number) => void;
    batchSize?: number;
  },
  onBatch: (batch: ExtractedJpeg[], done: number, total: number) => Promise<void> | void,
): Promise<number> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("無法讀取這支影片"));
    });
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const fps = opts.fps > 0 ? clampFps(opts.fps) : DEFAULT_PLAYBACK_FPS;
    const natural = Math.max(1, Math.floor(duration * fps));
    const total =
      opts.maxFrames && opts.maxFrames > 0 ? Math.min(natural, opts.maxFrames) : natural;
    const { width, height } = scaledSize(video.videoWidth, video.videoHeight, opts.maxWidth ?? 640);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    const batchSize = Math.max(1, opts.batchSize ?? INGEST_HTTP_BATCH);
    let batch: ExtractedJpeg[] = [];
    for (let i = 0; i < total; i += 1) {
      const t = Math.min(Math.max(0, duration - 0.001), i / fps);
      video.currentTime = t;
      await waitSeeked(video);
      const frame = await rasterToJpeg(video, width, height, canvas, ctx, i);
      if (frame) batch.push(frame);
      opts.onProgress?.(i + 1, total);
      if (batch.length >= batchSize) {
        await onBatch(batch, i + 1, total);
        batch = [];
      }
    }
    if (batch.length > 0) await onBatch(batch, total, total);
    return total;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function extractImageSequence(
  files: File[],
  opts: { maxWidth?: number; onProgress?: (done: number, total: number) => void },
): Promise<ExtractedJpeg[]> {
  const frames: ExtractedJpeg[] = [];
  await extractImageSequenceBatches(files, opts, async (batch) => {
    frames.push(...batch);
  });
  return frames;
}

/** Read an image sequence in batches. No 160-frame slice. */
export async function extractImageSequenceBatches(
  files: File[],
  opts: {
    maxWidth?: number;
    onProgress?: (done: number, total: number) => void;
    batchSize?: number;
  },
  onBatch: (batch: ExtractedJpeg[], done: number, total: number) => Promise<void> | void,
): Promise<number> {
  const sorted = [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  const maxW = opts.maxWidth ?? 640;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  const batchSize = Math.max(1, opts.batchSize ?? INGEST_HTTP_BATCH);
  let batch: ExtractedJpeg[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const url = URL.createObjectURL(sorted[i]);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error(`無法讀取 ${sorted[i].name}`));
        el.src = url;
      });
      const { width, height } = scaledSize(img.width, img.height, maxW);
      const frame = await rasterToJpeg(img, width, height, canvas, ctx, i);
      if (frame) batch.push(frame);
    } finally {
      URL.revokeObjectURL(url);
    }
    opts.onProgress?.(i + 1, sorted.length);
    if (batch.length >= batchSize) {
      await onBatch(batch, i + 1, sorted.length);
      batch = [];
    }
  }
  if (batch.length > 0) await onBatch(batch, sorted.length, sorted.length);
  return sorted.length;
}
