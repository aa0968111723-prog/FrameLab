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
    const last = out[out.length - 1]!;
    const cur = sorted[i]!;
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
      return { glyph: "★", title: "關鍵影格" };
    case "BREAKDOWN":
      return { glyph: "◆", title: "分解影格" };
    case "GENERATED_BREAKDOWN":
      return { glyph: "◆", title: "產生的分解影格" };
    case "GENERATED":
      return { glyph: "生", title: "產生格" };
    case "REPAIRED":
      return { glyph: "修", title: "修復格" };
    case "HOLD":
      return { glyph: "停", title: "停留格" };
    case "INBETWEEN":
      return { glyph: "●", title: "中間影格" };
    default:
      return { glyph: "·", title: "影格" };
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
    const key = keys[i]!;
    const nextKey = keys[i + 1];
    const breakdown = breaks.find((b) => b.frameNumber > key && (nextKey == null || b.frameNumber < nextKey))?.frameNumber;
    out.push({ key, breakdown, nextKey });
  }
  return out;
}

export function maskTrackMarks(
  track: { frame: number; lost?: boolean; confidence?: number; status?: string }[],
): { frame: number; status: "ok" | "warn" | "lost" }[] {
  return track.map((t) => ({
    frame: t.frame,
    status:
      t.status === "lost" || t.status === "warn" || t.status === "ok"
        ? t.status
        : t.lost || (t.confidence != null && t.confidence < 0.35)
          ? "lost"
          : t.confidence != null && t.confidence < 0.6
            ? "warn"
            : "ok",
  }));
}

export function visibleCellRange(
  cells: { left: number; width: number }[],
  scrollLeft: number,
  viewWidth: number,
  overscanPx = 240,
): { start: number; end: number } {
  if (cells.length === 0) return { start: 0, end: 0 };
  const lo = scrollLeft - overscanPx;
  const hi = scrollLeft + viewWidth + overscanPx;
  let a = 0;
  let b = cells.length;
  while (a < b) {
    const m = (a + b) >> 1;
    const c = cells[m]!;
    if (c.left + c.width < lo) a = m + 1;
    else b = m;
  }
  let end = a;
  while (end < cells.length && cells[end]!.left <= hi) end += 1;
  return { start: a, end };
}

export function sliceVisible<T extends { left: number; width: number }>(
  cells: T[],
  scrollLeft: number,
  viewWidth: number,
  overscanPx?: number,
): T[] {
  const { start, end } = visibleCellRange(cells, scrollLeft, viewWidth, overscanPx);
  return cells.slice(start, end);
}

export function cellIndexAtX(cells: { left: number; width: number }[], x: number): number {
  if (cells.length === 0) return 0;
  const last = cells[cells.length - 1]!;
  const px = Math.min(last.left + last.width - 1, Math.max(0, x));
  let a = 0;
  let b = cells.length - 1;
  while (a < b) {
    const m = (a + b) >> 1;
    const c = cells[m]!;
    if (px >= c.left + c.width) a = m + 1;
    else b = m;
  }
  return a;
}

export function visibleFlowSegments(
  flow: KeyFlow[],
  viewStartFrame: number,
  viewEndFrame: number,
): KeyFlow[] {
  return flow.filter(
    (f) => f.nextKey != null && f.key <= viewEndFrame && (f.nextKey ?? f.key) >= viewStartFrame,
  );
}

export function visibleSpans<T extends { start: number; end: number }>(
  spans: T[],
  viewStartFrame: number,
  viewEndFrame: number,
): T[] {
  return spans.filter((s) => s.end >= viewStartFrame && s.start <= viewEndFrame);
}

/** Upper bound on timeline DOM nodes for a viewport. Independent of total frames. */
export function timelineDomEstimate(opts: {
  containerWidth: number;
  cellWidth: number;
  total: number;
  overscan?: number;
  flowInView?: number;
  spansInView?: number;
}): number {
  const win = timelineWindow({
    scrollLeft: 0,
    containerWidth: opts.containerWidth,
    cellWidth: opts.cellWidth,
    total: opts.total,
    overscan: opts.overscan,
  });
  return win.visibleCount + (opts.flowInView ?? 0) + (opts.spansInView ?? 0) + 8;
}
