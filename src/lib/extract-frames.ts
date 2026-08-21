export type ExtractedJpeg = {
  frameNumber: number;
  imageData: string;
  width: number;
  height: number;
};

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

export async function extractVideoFrames(
  file: File,
  opts: {
    fps: number;
    maxFrames?: number;
    maxWidth?: number;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<ExtractedJpeg[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Could not read this video"));
  });
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const fps = Math.max(1, Math.min(30, opts.fps));
  const cap = opts.maxFrames ?? 96;
  const maxDuration = cap / fps;
  const useDuration = Math.min(duration, maxDuration);
  const total = Math.max(1, Math.floor(useDuration * fps));
  const maxW = opts.maxWidth ?? 640;
  const scale = Math.min(1, maxW / (video.videoWidth || maxW));
  const width = Math.max(2, Math.round((video.videoWidth || 480) * scale) & ~1);
  const height = Math.max(2, Math.round((video.videoHeight || 270) * scale) & ~1);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  const frames: ExtractedJpeg[] = [];
  for (let i = 0; i < total; i += 1) {
    const t = Math.min(duration - 0.001, i / fps);
    video.currentTime = Math.max(0, t);
    await waitSeeked(video);
    ctx.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82),
    );
    if (!blob) continue;
    const imageData = await blobToBase64(blob);
    frames.push({ frameNumber: i, imageData, width, height });
    opts.onProgress?.(i + 1, total);
  }
  URL.revokeObjectURL(url);
  return frames;
}

export async function extractImageSequence(
  files: File[],
  opts: { maxWidth?: number; onProgress?: (done: number, total: number) => void },
): Promise<ExtractedJpeg[]> {
  const sorted = [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  const cap = sorted.slice(0, 160);
  const maxW = opts.maxWidth ?? 640;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  const out: ExtractedJpeg[] = [];
  for (let i = 0; i < cap.length; i += 1) {
    const url = URL.createObjectURL(cap[i]);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`Could not read ${cap[i].name}`));
      el.src = url;
    });
    const scale = Math.min(1, maxW / img.width);
    const width = Math.max(2, Math.round(img.width * scale) & ~1);
    const height = Math.max(2, Math.round(img.height * scale) & ~1);
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82),
    );
    URL.revokeObjectURL(url);
    if (!blob) continue;
    out.push({
      frameNumber: i,
      imageData: await blobToBase64(blob),
      width,
      height,
    });
    opts.onProgress?.(i + 1, cap.length);
  }
  return out;
}
