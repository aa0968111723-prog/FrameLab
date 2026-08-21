/** Honest lightweight visual analysis. Not pose. Not optical-flow AI. */

import {
  histogram16,
  histogramDistance,
  meanAbsDiff,
  meanLuma,
  motionField,
  type RgbaFrame,
  type RegionBox,
} from "./pixel-metrics.ts";

export const LIGHTWEIGHT_KIND = "lightweight visual analysis" as const;

export type Observation = {
  kind: "mae" | "histogram" | "luma" | "centroid" | "edge" | "ssim_like" | "motion_block";
  frames: [number, number];
  value: number;
  note: string;
};

export type LightweightReport = {
  kind: typeof LIGHTWEIGHT_KIND;
  summary: string;
  frames: number[];
  observations: Observation[];
  available_metrics: Record<string, number>;
  limitations: string[];
};

export function cropRgba(frame: RgbaFrame, box: RegionBox): RgbaFrame {
  const x = Math.max(0, Math.min(frame.width - 1, Math.round(box.x)));
  const y = Math.max(0, Math.min(frame.height - 1, Math.round(box.y)));
  const w = Math.max(1, Math.min(frame.width - x, Math.round(box.w) || 1));
  const h = Math.max(1, Math.min(frame.height - y, Math.round(box.h) || 1));
  const data = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row += 1) {
    for (let col = 0; col < w; col += 1) {
      const si = ((y + row) * frame.width + (x + col)) * 4;
      const di = (row * w + col) * 4;
      data[di] = frame.data[si];
      data[di + 1] = frame.data[si + 1];
      data[di + 2] = frame.data[si + 2];
      data[di + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

export function edgeMagnitude(frame: RgbaFrame): number {
  const { data, width, height } = frame;
  let s = 0;
  let n = 0;
  const luma = (i: number) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const i = (y * width + x) * 4;
      const right = luma(i + 4);
      const down = luma(((y + 1) * width + x) * 4);
      const here = luma(i);
      s += Math.abs(here - right) + Math.abs(here - down);
      n += 2;
    }
  }
  return n === 0 ? 0 : s / n / 255;
}

/** Cheap structural similarity stand-in on luma. Not a published SSIM implementation. */
export function ssimLike(a: RgbaFrame, b: RgbaFrame): number {
  const n = Math.min(a.data.length, b.data.length);
  if (n < 4) return 0;
  let meanA = 0;
  let meanB = 0;
  let count = 0;
  for (let i = 0; i < n; i += 4) {
    meanA += 0.2126 * a.data[i] + 0.7152 * a.data[i + 1] + 0.0722 * a.data[i + 2];
    meanB += 0.2126 * b.data[i] + 0.7152 * b.data[i + 1] + 0.0722 * b.data[i + 2];
    count += 1;
  }
  meanA /= count;
  meanB /= count;
  let varA = 0;
  let varB = 0;
  let cov = 0;
  for (let i = 0; i < n; i += 4) {
    const la = 0.2126 * a.data[i] + 0.7152 * a.data[i + 1] + 0.0722 * a.data[i + 2] - meanA;
    const lb = 0.2126 * b.data[i] + 0.7152 * b.data[i + 1] + 0.0722 * b.data[i + 2] - meanB;
    varA += la * la;
    varB += lb * lb;
    cov += la * lb;
  }
  varA /= count;
  varB /= count;
  cov /= count;
  const c1 = 6.5025;
  const c2 = 58.5225;
  const num = (2 * meanA * meanB + c1) * (2 * cov + c2);
  const den = (meanA * meanA + meanB * meanB + c1) * (varA + varB + c2);
  if (den === 0) return 1;
  return Math.max(0, Math.min(1, num / den));
}

export function lumaCentroid(frame: RgbaFrame): { x: number; y: number } {
  const { data, width, height } = frame;
  let sx = 0;
  let sy = 0;
  let w = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const luma = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      sx += x * luma;
      sy += y * luma;
      w += luma;
    }
  }
  if (w <= 0) return { x: 0.5, y: 0.5 };
  return { x: sx / w / Math.max(1, width - 1), y: sy / w / Math.max(1, height - 1) };
}

export function comparePair(
  a: RgbaFrame,
  b: RgbaFrame,
  frameA: number,
  frameB: number,
): Observation[] {
  const mae = meanAbsDiff(a, b);
  const hist = histogramDistance(histogram16(a), histogram16(b));
  const luma = Math.abs(meanLuma(a) - meanLuma(b));
  const edge = Math.abs(edgeMagnitude(a) - edgeMagnitude(b));
  const ssim = ssimLike(a, b);
  const ca = lumaCentroid(a);
  const cb = lumaCentroid(b);
  const disp = Math.hypot(ca.x - cb.x, ca.y - cb.y);
  const motion = motionField(a, b);
  return [
    {
      kind: "mae",
      frames: [frameA, frameB],
      value: mae,
      note: "平均 RGB 差，範圍 0–1",
    },
    {
      kind: "histogram",
      frames: [frameA, frameB],
      value: hist,
      note: "16 桶 RGB 直方圖 L1 / 6",
    },
    {
      kind: "luma",
      frames: [frameA, frameB],
      value: luma,
      note: "平均亮度跳變",
    },
    {
      kind: "edge",
      frames: [frameA, frameB],
      value: edge,
      note: "相鄰像素邊緣量變化（非正式 Sobel）",
    },
    {
      kind: "ssim_like",
      frames: [frameA, frameB],
      value: ssim,
      note: "亮度協方差近似；不是公開 SSIM",
    },
    {
      kind: "centroid",
      frames: [frameA, frameB],
      value: disp,
      note: "裁切內正規化亮度質心位移",
    },
    {
      kind: "motion_block",
      frames: [frameA, frameB],
      value: motion.magnitude,
      note: `16×16 區塊比對，方向 ${motion.direction.toFixed(2)} rad — 不是 SEA-RAFT`,
    },
  ];
}

export function summarizeObservations(
  observations: Observation[],
  frames: number[],
  region: boolean,
): LightweightReport {
  const mae = observations.filter((o) => o.kind === "mae");
  const spike = [...mae].sort((a, b) => b.value - a.value)[0];
  const meanMae =
    mae.length === 0 ? 0 : mae.reduce((s, o) => s + o.value, 0) / mae.length;
  const parts: string[] = [];
  const where = region ? "已選區域" : "整格";
  if (frames.length) {
    parts.push(
      `${where}：F${frames[0]}–F${frames[frames.length - 1]}。`,
    );
  }
  if (spike && mae.length > 1 && spike.value > meanMae * 1.4 && spike.value > 0.04) {
    parts.push(
      `最大像素跳變在 F${spike.frames[0]}→F${spike.frames[1]}（MAE ${spike.value.toFixed(3)}，平均 ${meanMae.toFixed(3)}）。`,
    );
  } else if (spike) {
    parts.push(
      `像素變化相對平均（峰值 MAE ${spike.value.toFixed(3)}）。`,
    );
  } else {
    parts.push("鄰近影格不夠，無法比對。");
  }
  const centroid = observations.filter((o) => o.kind === "centroid");
  const maxDisp = [...centroid].sort((a, b) => b.value - a.value)[0];
  if (maxDisp && maxDisp.value > 0.08) {
    parts.push(
      `${where}亮度質心在 F${maxDisp.frames[0]} 與 F${maxDisp.frames[1]} 之間位移 ${maxDisp.value.toFixed(3)}（正規化）。`,
    );
  }
  const metrics: Record<string, number> = {};
  for (const o of observations) {
    metrics[`${o.kind}_F${o.frames[0]}_${o.frames[1]}`] = Number(o.value.toFixed(5));
  }
  return {
    kind: LIGHTWEIGHT_KIND,
    summary: parts.join(" "),
    frames,
    observations,
    available_metrics: metrics,
    limitations: [
      "這是輕量視覺分析（像素 MAE、直方圖、亮度質心、16×16 區塊比對）。",
      "沒有骨架／姿態／手部關鍵點 — RTMPose 未載入。",
      "沒有 SAM 遮罩。選區若有，是矩形。",
      "不要回報關節角度或身份分數；那些指標不存在。Do not report joint angles or identity scores.",
    ],
  };
}
