/** Real pixel metrics. No model. No invented scores. */

export type RgbaFrame = {
  data: Uint8Array;
  width: number;
  height: number;
};

export function meanLuma(frame: RgbaFrame): number {
  const { data } = frame;
  let s = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    s += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    n += 1;
  }
  return n === 0 ? 0 : s / n / 255;
}

export function meanAbsDiff(a: RgbaFrame, b: RgbaFrame): number {
  const n = Math.min(a.data.length, b.data.length);
  if (n === 0) return 0;
  let s = 0;
  let c = 0;
  for (let i = 0; i < n; i += 4) {
    s += Math.abs(a.data[i] - b.data[i]);
    s += Math.abs(a.data[i + 1] - b.data[i + 1]);
    s += Math.abs(a.data[i + 2] - b.data[i + 2]);
    c += 3;
  }
  return c === 0 ? 0 : s / c / 255;
}

export function histogram16(frame: RgbaFrame): {
  r: number[];
  g: number[];
  b: number[];
} {
  const r = new Array<number>(16).fill(0);
  const g = new Array<number>(16).fill(0);
  const b = new Array<number>(16).fill(0);
  const { data } = frame;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    r[data[i] >> 4] += 1;
    g[data[i + 1] >> 4] += 1;
    b[data[i + 2] >> 4] += 1;
    n += 1;
  }
  if (n === 0) return { r, g, b };
  for (let i = 0; i < 16; i += 1) {
    r[i] /= n;
    g[i] /= n;
    b[i] /= n;
  }
  return { r, g, b };
}

export function histogramDistance(
  a: ReturnType<typeof histogram16>,
  b: ReturnType<typeof histogram16>,
): number {
  let s = 0;
  for (let i = 0; i < 16; i += 1) {
    s += Math.abs(a.r[i] - b.r[i]);
    s += Math.abs(a.g[i] - b.g[i]);
    s += Math.abs(a.b[i] - b.b[i]);
  }
  return s / 6;
}

export function motionField(a: RgbaFrame, b: RgbaFrame): {
  magnitude: number;
  direction: number;
} {
  // Block-match 16x16 on a coarse grid. Honest: this is block matching, not SEA-RAFT.
  const block = 16;
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  let sumDx = 0;
  let sumDy = 0;
  let sumMag = 0;
  let samples = 0;
  const search = 6;

  for (let y = block; y + block < h; y += block * 2) {
    for (let x = block; x + block < w; x += block * 2) {
      const { dx, dy } = matchBlock(a, b, x, y, block, search);
      sumDx += dx;
      sumDy += dy;
      sumMag += Math.hypot(dx, dy);
      samples += 1;
    }
  }
  if (samples === 0) return { magnitude: 0, direction: 0 };
  return {
    magnitude: sumMag / samples,
    direction: Math.atan2(sumDy / samples, sumDx / samples),
  };
}

function matchBlock(
  a: RgbaFrame,
  b: RgbaFrame,
  x: number,
  y: number,
  block: number,
  search: number,
): { dx: number; dy: number } {
  let best = Infinity;
  let bx = 0;
  let by = 0;
  for (let dy = -search; dy <= search; dy += 2) {
    for (let dx = -search; dx <= search; dx += 2) {
      const err = blockSad(a, b, x, y, x + dx, y + dy, block);
      if (err < best) {
        best = err;
        bx = dx;
        by = dy;
      }
    }
  }
  return { dx: bx, dy: by };
}

function blockSad(
  a: RgbaFrame,
  b: RgbaFrame,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  block: number,
): number {
  if (bx < 0 || by < 0 || bx + block > b.width || by + block > b.height) {
    return Infinity;
  }
  let s = 0;
  for (let j = 0; j < block; j += 2) {
    for (let i = 0; i < block; i += 2) {
      const ai = ((ay + j) * a.width + (ax + i)) * 4;
      const bi = ((by + j) * b.width + (bx + i)) * 4;
      s += Math.abs(a.data[ai] - b.data[bi]);
      s += Math.abs(a.data[ai + 1] - b.data[bi + 1]);
      s += Math.abs(a.data[ai + 2] - b.data[bi + 2]);
    }
  }
  return s;
}

export type MotionVector = {
  x: number;
  y: number;
  dx: number;
  dy: number;
  mag: number;
};

/** Coarse block-matching grid. Honest: not SEA-RAFT. */
export function motionGrid(
  a: RgbaFrame,
  b: RgbaFrame,
  step = 32,
): MotionVector[] {
  const block = 16;
  const search = 8;
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const out: MotionVector[] = [];
  for (let y = block; y + block < h; y += step) {
    for (let x = block; x + block < w; x += step) {
      const { dx, dy } = matchBlock(a, b, x, y, block, search);
      out.push({ x, y, dx, dy, mag: Math.hypot(dx, dy) });
    }
  }
  return out;
}

export function lumaVariance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  let s = 0;
  for (const v of values) s += (v - mean) * (v - mean);
  return s / values.length;
}

export function blendRgba(
  a: RgbaFrame,
  b: RgbaFrame,
  t: number,
): RgbaFrame {
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const data = new Uint8Array(width * height * 4);
  const u = 1 - t;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ai = (y * a.width + x) * 4;
      const bi = (y * b.width + x) * 4;
      const oi = (y * width + x) * 4;
      data[oi] = Math.round(a.data[ai] * u + b.data[bi] * t);
      data[oi + 1] = Math.round(a.data[ai + 1] * u + b.data[bi + 1] * t);
      data[oi + 2] = Math.round(a.data[ai + 2] * u + b.data[bi + 2] * t);
      data[oi + 3] = 255;
    }
  }
  return { data, width, height };
}

export type RegionBox = { x: number; y: number; w: number; h: number };

export function clampBox(box: RegionBox, width: number, height: number): RegionBox {
  const x = Math.max(0, Math.min(Math.max(0, width - 1), Math.round(box.x)));
  const y = Math.max(0, Math.min(Math.max(0, height - 1), Math.round(box.y)));
  const w = Math.max(1, Math.min(width - x, Math.round(box.w) || 1));
  const h = Math.max(1, Math.min(height - y, Math.round(box.h) || 1));
  return { x, y, w, h };
}

/** Copy `src` pixels inside `box` onto a clone of `dest`. Rest of dest is unchanged. */
export function pasteRegion(dest: RgbaFrame, src: RgbaFrame, box: RegionBox): RgbaFrame {
  const b = clampBox(box, dest.width, dest.height);
  const data = new Uint8Array(dest.data);
  for (let y = 0; y < b.h; y += 1) {
    for (let x = 0; x < b.w; x += 1) {
      const dx = b.x + x;
      const dy = b.y + y;
      if (dx >= src.width || dy >= src.height) continue;
      const di = (dy * dest.width + dx) * 4;
      const si = (dy * src.width + dx) * 4;
      data[di] = src.data[si];
      data[di + 1] = src.data[si + 1];
      data[di + 2] = src.data[si + 2];
      data[di + 3] = 255;
    }
  }
  return { data, width: dest.width, height: dest.height };
}

export function downsample(
  frame: RgbaFrame,
  maxWidth: number,
  maxHeight: number,
): RgbaFrame {
  const scale = Math.min(1, maxWidth / frame.width, maxHeight / frame.height);
  if (scale >= 1) return frame;
  const width = Math.max(1, Math.round(frame.width * scale));
  const height = Math.max(1, Math.round(frame.height * scale));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(frame.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(frame.width - 1, Math.floor(x / scale));
      const si = (sy * frame.width + sx) * 4;
      const di = (y * width + x) * 4;
      data[di] = frame.data[si];
      data[di + 1] = frame.data[si + 1];
      data[di + 2] = frame.data[si + 2];
      data[di + 3] = 255;
    }
  }
  return { data, width, height };
}

export function detectLocalMaxima(
  values: number[],
  minValue: number,
): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length - 1; i += 1) {
    if (
      values[i] >= minValue &&
      values[i] >= values[i - 1] &&
      values[i] >= values[i + 1]
    ) {
      out.push(i);
    }
  }
  return out;
}

export function continuityScore(diff: number): number {
  // 0 = broken, 1 = identical. Gentle curve so small diffs stay high.
  return Math.max(0, Math.min(1, 1 - diff * 2.2));
}
