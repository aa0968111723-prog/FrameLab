import type { FrameType } from "./types";
import { encodeJpegBase64, hashBytes, makeThumbnail } from "./image-codec";
import type { RgbaFrame } from "./pixel-metrics";

export type GeneratedFrame = {
  frameNumber: number;
  timestampMs: number;
  durationMs: number;
  frameType: FrameType;
  imageData: string;
  thumbnailData: string;
  width: number;
  height: number;
  contentHash: string;
  notes: string;
};

function putPixel(
  buf: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a = 255,
) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  if (a >= 255) {
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = 255;
    return;
  }
  const u = a / 255;
  buf[i] = Math.round(buf[i] * (1 - u) + r * u);
  buf[i + 1] = Math.round(buf[i + 1] * (1 - u) + g * u);
  buf[i + 2] = Math.round(buf[i + 2] * (1 - u) + b * u);
  buf[i + 3] = 255;
}

function fillRect(
  buf: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  g: number,
  b: number,
) {
  const xa = Math.max(0, Math.floor(x0));
  const ya = Math.max(0, Math.floor(y0));
  const xb = Math.min(w - 1, Math.ceil(x1));
  const yb = Math.min(h - 1, Math.ceil(y1));
  for (let y = ya; y <= yb; y += 1) {
    for (let x = xa; x <= xb; x += 1) {
      putPixel(buf, w, h, x, y, r, g, b);
    }
  }
}

function fillEllipse(
  buf: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  r: number,
  g: number,
  b: number,
) {
  const x0 = Math.max(0, Math.floor(cx - rx - 1));
  const x1 = Math.min(w - 1, Math.ceil(cx + rx + 1));
  const y0 = Math.max(0, Math.floor(cy - ry - 1));
  const y1 = Math.min(h - 1, Math.ceil(cy + ry + 1));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d <= 0.85) {
        putPixel(buf, w, h, x, y, r, g, b);
      } else if (d <= 1.05) {
        const t = 1 - (d - 0.85) / 0.2;
        putPixel(buf, w, h, x, y, r, g, b, Math.round(220 * t));
      }
    }
  }
}

function renderBallFrame(
  width: number,
  height: number,
  t: number,
  bounces: number,
): RgbaFrame {
  const data = new Uint8Array(width * height * 4);
  // Background
  for (let i = 0; i < data.length; i += 4) {
    const y = Math.floor(i / 4 / width);
    const shade = 16 + Math.round((y / height) * 10);
    data[i] = shade;
    data[i + 1] = shade;
    data[i + 2] = shade + 2;
    data[i + 3] = 255;
  }

  // Ground plane
  const ground = height - 36;
  fillRect(data, width, height, 0, ground, width, height, 28, 28, 32);
  fillRect(data, width, height, 24, ground, width - 24, ground + 2, 70, 72, 78);

  const phase = t * Math.PI * bounces;
  const c = Math.cos(phase);
  const absC = Math.abs(c);
  const speed = Math.abs(Math.sin(phase));
  const ballR = Math.round(Math.min(width, height) * 0.09);
  const bounceH = ground - 48 - ballR * 2;
  const cx = Math.round(width * 0.5);
  const cy = Math.round(ground - ballR - bounceH * absC);

  const nearContact = absC < 0.18;
  let rx = ballR;
  let ry = ballR;
  if (nearContact) {
    const k = 1 - absC / 0.18;
    rx = ballR * (1 + 0.42 * k);
    ry = ballR * (1 - 0.38 * k);
  } else {
    rx = ballR * (1 - 0.22 * speed);
    ry = ballR * (1 + 0.28 * speed);
  }

  const shadowScale = 0.45 + (1 - absC) * 0.7;
  fillEllipse(
    data,
    width,
    height,
    cx,
    ground + 2,
    rx * 1.15 * shadowScale,
    5 * shadowScale,
    8,
    8,
    10,
  );

  fillEllipse(
    data,
    width,
    height,
    cx,
    cy,
    rx,
    ry,
    214,
    216,
    220,
  );
  fillEllipse(
    data,
    width,
    height,
    cx - rx * 0.28,
    cy - ry * 0.32,
    rx * 0.32,
    ry * 0.26,
    244,
    245,
    247,
  );

  return { data, width, height };
}

function keyTypeFor(t: number, bounces: number, index: number, total: number): FrameType {
  if (index === 0 || index === total - 1) return "KEY";
  const phase = t * bounces;
  const frac = phase - Math.floor(phase);
  if (frac < 0.04 || frac > 0.96) return "KEY";
  if (Math.abs(frac - 0.5) < 0.04) return "KEY";
  if (Math.abs(frac - 0.25) < 0.04 || Math.abs(frac - 0.75) < 0.04) return "BREAKDOWN";
  return "INBETWEEN";
}

export function generateBouncingBall(opts?: {
  frames?: number;
  width?: number;
  height?: number;
  fps?: number;
  bounces?: number;
}): GeneratedFrame[] {
  const count = opts?.frames ?? 24;
  const width = opts?.width ?? 480;
  const height = opts?.height ?? 270;
  const fps = opts?.fps ?? 24;
  const bounces = opts?.bounces ?? 2;
  const durationMs = Math.round(1000 / fps);
  const out: GeneratedFrame[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : i / (count - 1);
    const rgba = renderBallFrame(width, height, t, bounces);
    const imageData = encodeJpegBase64(rgba, 80);
    const thumbnailData = makeThumbnail(rgba);
    const frameType = keyTypeFor(t, bounces, i, count);
    out.push({
      frameNumber: i,
      timestampMs: i * durationMs,
      durationMs,
      frameType,
      imageData,
      thumbnailData,
      width,
      height,
      contentHash: hashBytes(imageData),
      notes:
        frameType === "KEY"
          ? "Contact or apex — squash / stretch extreme"
          : frameType === "BREAKDOWN"
            ? "Breakdown — mid-arc volume"
            : "",
    });
  }
  return out;
}
