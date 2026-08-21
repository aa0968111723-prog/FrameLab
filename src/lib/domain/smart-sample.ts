/** Choose frames worth re-analyzing. Honest pixel heuristics only. */

export type SampleHint = {
  frameNumber: number;
  reason:
    | "key"
    | "histogram"
    | "perceptual"
    | "flow_magnitude"
    | "scene_change"
    | "user"
    | "endpoint";
};

export function smartSample(input: {
  frameCount: number;
  keys: number[];
  diffs: number[];
  histogramDistances: number[];
  magnitudes: number[];
  userSelected?: number[];
  maxSamples?: number;
}): SampleHint[] {
  const n = input.frameCount;
  if (n <= 0) return [];
  const picked = new Map<number, SampleHint["reason"]>();
  const mark = (i: number, reason: SampleHint["reason"]) => {
    if (i < 0 || i >= n) return;
    if (!picked.has(i)) picked.set(i, reason);
  };
  mark(0, "endpoint");
  mark(n - 1, "endpoint");
  for (const k of input.keys) mark(k, "key");
  for (const u of input.userSelected ?? []) mark(u, "user");

  const mean = (arr: number[]) =>
    arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
  const dMean = mean(input.diffs);
  const hMean = mean(input.histogramDistances);
  const mMean = mean(input.magnitudes);

  for (let i = 1; i < n; i += 1) {
    if ((input.diffs[i] ?? 0) > dMean * 1.8) mark(i, "perceptual");
    if ((input.histogramDistances[i] ?? 0) > hMean * 1.8 + 0.08) mark(i, "histogram");
    if ((input.magnitudes[i] ?? 0) > mMean * 2 + 1.5) mark(i, "flow_magnitude");
    if ((input.diffs[i] ?? 0) > 0.35) mark(i, "scene_change");
  }

  let out: SampleHint[] = [...picked.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([frameNumber, reason]) => ({ frameNumber, reason }));
  const cap = input.maxSamples ?? n;
  if (out.length > cap) {
    out = out.filter((s) => s.reason === "key" || s.reason === "endpoint" || s.reason === "user");
  }
  return out;
}
