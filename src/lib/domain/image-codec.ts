import { decode as jpegDecode, encode as jpegEncode } from "jpeg-js";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import type { RgbaFrame } from "./pixel-metrics.ts";

export function decodeJpegBuffer(raw: Buffer): RgbaFrame {
  const decoded = jpegDecode(raw, { useTArray: true });
  return {
    data: decoded.data as Uint8Array,
    width: decoded.width,
    height: decoded.height,
  };
}

export function decodeJpegBase64(b64: string): RgbaFrame {
  return decodeJpegBuffer(Buffer.from(b64, "base64"));
}

export function encodeJpegBuffer(frame: RgbaFrame, quality = 78): Buffer {
  const encoded = jpegEncode(
    { data: frame.data, width: frame.width, height: frame.height },
    quality,
  );
  return Buffer.from(encoded.data);
}

export function encodeJpegBase64(frame: RgbaFrame, quality = 78): string {
  return encodeJpegBuffer(frame, quality).toString("base64");
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c ^= bytes[i]!;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Unfiltered RGBA PNG. Used for animation sequence export (spec: PNG sequence). */
export function encodePng(frame: RgbaFrame): Buffer {
  const { width, height, data } = frame;
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    const src = y * width * 4;
    raw.set(data.subarray(src, src + width * 4), y * stride + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

export function hashBytes(b64: string): string {
  return createHash("sha256").update(b64).digest("hex").slice(0, 24);
}

export function hashBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 24);
}

export function scaleRgba(frame: RgbaFrame, maxW: number, maxH: number): RgbaFrame {
  const scale = Math.min(1, maxW / Math.max(1, frame.width), maxH / Math.max(1, frame.height));
  if (scale >= 0.999) {
    return { data: frame.data, width: frame.width, height: frame.height };
  }
  const width = Math.max(1, Math.round(frame.width * scale));
  const height = Math.max(1, Math.round(frame.height * scale));
  const data = new Uint8Array(width * height * 4);
  const inv = 1 / scale;
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(frame.height - 1, Math.round(y * inv));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(frame.width - 1, Math.round(x * inv));
      const si = (sy * frame.width + sx) * 4;
      const di = (y * width + x) * 4;
      data[di] = frame.data[si]!;
      data[di + 1] = frame.data[si + 1]!;
      data[di + 2] = frame.data[si + 2]!;
      data[di + 3] = 255;
    }
  }
  return { data, width, height };
}

export function makeThumbnail(frame: RgbaFrame, maxW = 96, maxH = 54): string {
  return encodeJpegBase64(scaleRgba(frame, maxW, maxH), 62);
}

export function dataUrl(b64: string, mime = "image/jpeg"): string {
  if (!b64) return "";
  if (b64.startsWith("data:")) return b64;
  return `data:${mime};base64,${b64}`;
}
