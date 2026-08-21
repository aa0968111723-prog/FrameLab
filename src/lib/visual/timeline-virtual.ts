/** Virtualize timeline cells so 10k frames do not explode the DOM. */

export type VirtualWindow = {
  start: number;
  end: number;
  offset: number;
  totalWidth: number;
  cellWidth: number;
  visibleCount: number;
};

export function timelineWindow(opts: {
  scrollLeft: number;
  containerWidth: number;
  cellWidth: number;
  total: number;
  overscan?: number;
}): VirtualWindow {
  const cell = Math.max(8, opts.cellWidth);
  const overscan = opts.overscan ?? 6;
  const total = Math.max(0, opts.total);
  const start = Math.max(0, Math.floor(opts.scrollLeft / cell) - overscan);
  const visibleCount = Math.ceil(opts.containerWidth / cell) + overscan * 2;
  const end = Math.min(total, start + visibleCount);
  return {
    start,
    end,
    offset: start * cell,
    totalWidth: total * cell,
    cellWidth: cell,
    visibleCount: Math.max(0, end - start),
  };
}

export function cellWidthForZoom(zoom: number, min = 28, max = 112): number {
  return Math.round(Math.min(max, Math.max(min, 56 * zoom)));
}

export type ProblemSpan = { start: number; end: number; severity: string; category?: string };

export function mergeProblemSpans(spans: ProblemSpan[]): ProblemSpan[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: ProblemSpan[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i += 1) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end + 1) {
      last.end = Math.max(last.end, cur.end);
      if (severityRank(cur.severity) > severityRank(last.severity)) last.severity = cur.severity;
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

function severityRank(s: string): number {
  if (s === "critical" || s === "error") return 3;
  if (s === "warning") return 2;
  if (s === "info") return 1;
  return 0;
}

export function frameTypeMark(type: string): { glyph: string; title: string } {
  switch (type) {
    case "KEY":
      return { glyph: "★", title: "Keyframe" };
    case "BREAKDOWN":
      return { glyph: "◆", title: "Breakdown" };
    case "GENERATED_BREAKDOWN":
      return { glyph: "◆", title: "Generated breakdown" };
    case "GENERATED":
      return { glyph: "G", title: "Generated" };
    case "REPAIRED":
      return { glyph: "R", title: "Repaired" };
    case "HOLD":
      return { glyph: "H", title: "Hold" };
    case "INBETWEEN":
      return { glyph: "●", title: "Inbetween" };
    default:
      return { glyph: "·", title: type };
  }
}

export function frameAtX(x: number, cellWidth: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(total - 1, Math.max(0, Math.floor(x / Math.max(1, cellWidth))));
}

export type KeyFlow = { key: number; breakdown?: number; nextKey?: number };

export function keyBreakdownFlow(
  frames: { frameNumber: number; frameType: string }[],
): KeyFlow[] {
  const keys = frames.filter((f) => f.frameType === "KEY").map((f) => f.frameNumber);
  const breaks = frames.filter((f) => f.frameType === "BREAKDOWN" || f.frameType === "GENERATED_BREAKDOWN");
  const out: KeyFlow[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const nextKey = keys[i + 1];
    const breakdown = breaks.find((b) => b.frameNumber > key && (nextKey == null || b.frameNumber < nextKey))?.frameNumber;
    out.push({ key, breakdown, nextKey });
  }
  return out;
}

export function maskTrackMarks(
  track: { frame: number; lost?: boolean; confidence?: number }[],
): { frame: number; status: "ok" | "warn" | "lost" }[] {
  return track.map((t) => ({
    frame: t.frame,
    status: t.lost || (t.confidence != null && t.confidence < 0.35) ? "lost" : (t.confidence != null && t.confidence < 0.6 ? "warn" : "ok"),
  }));
}
