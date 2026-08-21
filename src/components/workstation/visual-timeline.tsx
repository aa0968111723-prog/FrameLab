/** Virtualized timeline with thumbnails, frame types, problem ranges, hover preview. */

import { useEffect, useMemo, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { padFrame } from "@/lib/domain/types";
import type { TimelineEngineState } from "@/lib/domain/types";
import {
  cellWidthForZoom,
  frameTypeMark,
  mergeProblemSpans,
  timelineWindow,
  keyBreakdownFlow,
  sliceVisible,
  cellIndexAtX,
  visibleFlowSegments,
  visibleSpans,
  type ProblemSpan,
} from "@/lib/visual/timeline-virtual";
import { drawingAtTick, exposureLabel, layoutExposureStrip } from "@/lib/domain/exposure";
import { cn } from "@/lib/utils";

import { jpegUrl } from "@/lib/visual/jpeg-url";
import { ThumbnailCache, createBrowserThumbLoader, neighborIds } from "@/lib/visual/thumbnail-cache";

export type TimelineFrame = {
  id: string;
  frameNumber: number;
  frameType: string;
  thumbnailData: string;
  isLocked?: boolean;
  exposureCount?: number;
};

export type MaskMark = { frame: number; status: "ok" | "warn" | "lost" };

export function VisualTimeline({
  frames,
  engine,
  timelineZoom,
  consMap,
  problemRanges,
  highlightRange,
  repairRange,
  conversationFrames,
  maskTrack,
  dimFrames,
  onSeek,
  onScrub,
  onZoomTimeline,
  onConversation,
  ops,
}: {
  frames: TimelineFrame[];
  engine: TimelineEngineState;
  timelineZoom: number;
  consMap: Map<number, { severity: string }>;
  problemRanges: { start: number; end: number; severity: string; category?: string }[];
  highlightRange: [number, number] | null;
  repairRange: [number, number] | null;
  conversationFrames?: number[];
  maskTrack?: MaskMark[];
  dimFrames?: Set<number>;
  onSeek: (n: number, shift: boolean) => void;
  onScrub: (n: number) => void;
  onZoomTimeline: (z: number) => void;
  onConversation?: (n: number) => void;
  ops?: {
    busy?: boolean;
    onAdd: () => void;
    onInsert: () => void;
    onDuplicate: () => void;
    onClear: () => void;
    onHold: () => void;
    onDelete: () => void;
  };
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<ThumbnailCache | null>(null);
  if (!cacheRef.current) cacheRef.current = new ThumbnailCache(96, createBrowserThumbLoader());
  const [scrollLeft, setScrollLeft] = useState(0);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<{ n: number; x: number; src: string } | null>(null);
  const dragging = useRef(false);
  const pendingScroll = useRef(0);
  const scrollRaf = useRef(0);
  const cell = cellWidthForZoom(timelineZoom);
  const layout = useMemo(() => layoutExposureStrip(frames, cell), [frames, cell]);
  const byNum = useMemo(() => new Map(layout.cells.map((c) => [c.frameNumber, c])), [layout]);
  const byId = useMemo(() => new Map(frames.map((f) => [f.id, f])), [frames]);
  const win = timelineWindow({
    scrollLeft,
    containerWidth: width,
    cellWidth: cell,
    total: Math.max(1, layout.totalTicks),
  });

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => {
      ro.disconnect();
      if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
    };
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const cur = byNum.get(engine.currentFrame);
    const x = (cur?.left ?? engine.currentFrame * cell) + (cur?.width ?? cell) / 2 - width / 2;
    if (!dragging.current && Math.abs(el.scrollLeft - x) > cell * 4) el.scrollTo({ left: Math.max(0, x) });
  }, [engine.currentFrame, cell, width, byNum]);

  const spans = useMemo(
    () => mergeProblemSpans(problemRanges as ProblemSpan[]),
    [problemRanges],
  );
  const slice = useMemo(
    () => sliceVisible(layout.cells, scrollLeft, width, cell * 8),
    [layout.cells, scrollLeft, width, cell],
  );
  const flow = useMemo(() => keyBreakdownFlow(frames), [frames]);
  const viewStart = slice[0]?.frameNumber ?? 0;
  const viewEnd = slice[slice.length - 1]?.frameNumber ?? viewStart;
  const flowInView = useMemo(
    () => visibleFlowSegments(flow, viewStart, viewEnd),
    [flow, viewStart, viewEnd],
  );
  const spansInView = useMemo(
    () => visibleSpans(spans, viewStart, viewEnd),
    [spans, viewStart, viewEnd],
  );
  const maskBy = useMemo(() => new Map((maskTrack ?? []).map((m) => [m.frame, m.status])), [maskTrack]);

  useEffect(() => {
    const cache = cacheRef.current;
    if (!cache) return;
    const resolve = (id: string) => {
      const f = byId.get(id);
      return f?.thumbnailData ? jpegUrl(f.thumbnailData) : null;
    };
    const ids = neighborIds(frames, engine.currentFrame, 8);
    for (const c of slice) ids.push(c.id);
    cache.preload(ids, resolve);
  }, [frames, engine.currentFrame, slice, byId]);

  function pxRange(start: number, end: number) {
    const a = byNum.get(Math.min(start, end));
    const b = byNum.get(Math.max(start, end));
    const left = a?.left ?? start * cell;
    const right = b ? b.left + b.width : left + cell;
    return { left, width: Math.max(cell, right - left) };
  }

  function frameFromClientX(clientX: number) {
    const el = scroller.current;
    if (!el || layout.cells.length === 0) return 0;
    const x = el.scrollLeft + (clientX - el.getBoundingClientRect().left);
    const idx = cellIndexAtX(layout.cells, x);
    return layout.cells[idx]?.frameNumber ?? 0;
  }

  return (
    <div className="shrink-0 border-t border-border bg-surface">
      <MiniOverview
        frames={frames}
        current={engine.currentFrame}
        spans={spans}
        onJump={(n) => onSeek(n, false)}
      />
      <div className="flex items-center justify-between gap-2 px-3 py-0.5 text-[11px] text-faint">
        <span className="truncate">
          時間軸
          {engine.loopRange ? ` · 循環 F${engine.loopRange[0]}–F${engine.loopRange[1]}` : ""}
          {highlightRange ? ` · F${highlightRange[0]}–F${highlightRange[1]}` : ""}
          {repairRange ? ` · 修復 F${repairRange[0]}–F${repairRange[1]}` : ""}
        </span>
        {ops ? (
          <div className="flex shrink-0 items-center gap-0.5">
            {(
              [
                ["新增", ops.onAdd],
                ["插入", ops.onInsert],
                ["複製", ops.onDuplicate],
                ["停格", ops.onHold],
                ["清空", ops.onClear],
                ["刪除", ops.onDelete],
              ] as const
            ).map(([label, fn]) => (
              <button
                key={label}
                type="button"
                disabled={ops.busy}
                onClick={fn}
                className={cn(
                  "rounded-[var(--radius-xs)] px-1.5 py-0.5 text-[10px] text-muted hover:bg-raised hover:text-fg disabled:opacity-40",
                  label === "刪除" && "hover:text-warn",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        <label className="flex items-center gap-2">
          縮放
          <input
            type="range"
            min={0.5}
            max={2.4}
            step={0.1}
            value={timelineZoom}
            onChange={(e) => onZoomTimeline(Number(e.target.value))}
            aria-label="時間軸縮放"
          />
        </label>
      </div>
      <div
        ref={scroller}
        className="relative overflow-x-auto px-2 pb-2 scrollbar-thin"
        data-visible-cells={slice.length}
        onScroll={(e) => {
          pendingScroll.current = e.currentTarget.scrollLeft;
          if (scrollRaf.current) return;
          scrollRaf.current = requestAnimationFrame(() => {
            scrollRaf.current = 0;
            setScrollLeft(pendingScroll.current);
          });
        }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("[data-cell]")) return;
          dragging.current = true;
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          onScrub(frameFromClientX(e.clientX));
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          onScrub(frameFromClientX(e.clientX));
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
      >
        <div className="relative" style={{ width: layout.totalWidth || win.totalWidth, height: 78 }}>
          {flowInView.map((f) =>
            f.nextKey == null ? null : (
              <div
                key={`flow-${f.key}-${f.nextKey}`}
                className="pointer-events-none absolute top-1 h-0.5 bg-key/40"
                style={{
                  left: (byNum.get(f.key)?.left ?? f.key * cell) + (byNum.get(f.key)?.width ?? cell) / 2,
                  width: Math.max(8, (byNum.get(f.nextKey)?.left ?? f.nextKey * cell) - (byNum.get(f.key)?.left ?? f.key * cell)),
                }}
                title={`★ F${f.key}${f.breakdown != null ? ` ◆ F${f.breakdown}` : ""} ★ F${f.nextKey}`}
              />
            ),
          )}
          {spansInView.map((s) => {
            const r = pxRange(s.start, s.end);
            return (
            <button
              key={`span-${s.start}-${s.end}`}
              type="button"
              title={`問題 F${s.start}–F${s.end}`}
              onClick={() => onSeek(s.start, false)}
              className="absolute top-0 h-full rounded-[var(--radius-xs)] bg-warn/15 ring-1 ring-warn/40"
              style={{
                left: r.left,
                width: r.width,
              }}
            />
            );
          })}
          {repairRange && (
            <div
              className="pointer-events-none absolute top-0 h-full border border-repair/60 bg-repair/10"
              style={pxRange(repairRange[0], repairRange[1])}
            />
          )}
          {highlightRange && (
            <div
              className="pointer-events-none absolute bottom-0 h-1 bg-accent"
              style={pxRange(highlightRange[0], highlightRange[1])}
            />
          )}
          <div className="absolute top-0 left-0 h-full">
            {slice.map((cellLayout) => {
              const f = frames[cellLayout.drawingIndex];
              if (!f) return null;
              const active = f.frameNumber === engine.currentFrame;
              const selected = engine.selectedFrames.includes(f.frameNumber);
              const sev = consMap.get(f.frameNumber)?.severity;
              const mark = frameTypeMark(f.frameType);
              const talked = conversationFrames?.includes(f.frameNumber);
              const dim = dimFrames?.has(f.frameNumber);
              const mask = maskBy.get(f.frameNumber);
              const ticks = cellLayout.ticks;
              return (
                <button
                  key={f.id}
                  type="button"
                  data-cell
                  onClick={(e) => onSeek(f.frameNumber, e.shiftKey)}
                  onPointerEnter={(e) => {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setHover({ n: f.frameNumber, x: r.left + r.width / 2, src: jpegUrl(f.thumbnailData) });
                  }}
                  onPointerLeave={() => setHover(null)}
                  className={cn(
                    "absolute top-0 overflow-hidden border",
                    active ? "border-accent" : selected ? "border-key/60" : "border-border",
                    dim && "opacity-35",
                  )}
                  style={{ left: cellLayout.left, width: Math.max(8, cellLayout.width - 2), height: 70 }}
                  title={`${padFrame(f.frameNumber)} ${mark.title} · ${exposureLabel(ticks)}`}
                >
                  {f.thumbnailData ? (
                    <img
                      src={cacheRef.current?.remember(f.id, jpegUrl(f.thumbnailData)) || jpegUrl(f.thumbnailData)}
                      alt={padFrame(f.frameNumber)}
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <span className="grid h-full place-items-center text-[10px] text-faint">
                      {padFrame(f.frameNumber)}
                    </span>
                  )}
                  <span className="absolute left-0.5 top-0.5 font-mono text-[9px] tabular-nums text-fg/90">
                    {f.frameNumber}
                  </span>
                  {ticks > 1 && (
                    <span className="absolute left-0.5 bottom-0.5 text-[9px] tabular-nums text-fg/80" title={exposureLabel(ticks)}>
                      ×{ticks}
                    </span>
                  )}
                  <span
                    className={cn(
                      "absolute bottom-0.5 right-0.5 text-[9px] font-medium leading-none",
                      f.frameType === "KEY" && "text-key",
                      (f.frameType === "BREAKDOWN" || f.frameType === "GENERATED_BREAKDOWN") && "text-warn",
                      f.frameType === "GENERATED" && "text-gen",
                      f.frameType === "REPAIRED" && "text-repair",
                      f.frameType === "HOLD" && "text-faint",
                    )}
                  >
                    {mark.glyph}
                  </span>
                  {f.isLocked && (
                    <Lock className="absolute right-0.5 top-0.5 size-2.5 text-muted" />
                  )}
                  {sev && sev !== "ok" && (
                    <span className="absolute bottom-0.5 left-0.5 text-[9px] text-danger" title="問題">
                      ⚠
                    </span>
                  )}
                  {talked && (
                    <span
                      className="absolute left-0.5 top-2.5 text-[8px] leading-none"
                      title="對話"
                      onClick={(e) => {
                        e.stopPropagation();
                        onConversation?.(f.frameNumber);
                      }}
                    >
                      💬
                    </span>
                  )}
                  {mask && (
                    <span
                      className={cn(
                        "absolute right-0.5 top-3 size-1.5 rounded-full",
                        mask === "ok" ? "bg-good" : mask === "warn" ? "bg-warn" : "bg-danger",
                      )}
                      title={mask === "lost" ? "遮罩遺失" : mask === "warn" ? "遮罩信心不足" : "遮罩"}
                    />
                  )}
                </button>
              );
            })}
          </div>
          <div
            className="pointer-events-none absolute top-0 z-10 w-px bg-fg"
            style={{
              left: (byNum.get(engine.currentFrame)?.left ?? engine.currentFrame * cell) + (byNum.get(engine.currentFrame)?.width ?? cell) / 2,
              height: 78,
            }}
          />
        </div>
      </div>
      {hover && (
        <div
          className="pointer-events-none fixed z-40 -translate-x-1/2 overflow-hidden rounded-[var(--radius-sm)] border border-border bg-surface shadow-[var(--shadow-panel)]"
          style={{ left: hover.x, bottom: 110 }}
        >
          {hover.src ? (
            <img src={hover.src} alt="" className="h-28 w-44 object-cover" />
          ) : (
            <div className="grid h-28 w-44 place-items-center text-xs text-faint">F{hover.n}</div>
          )}
          <p className="px-2 py-1 font-mono text-[10px] text-muted">F{hover.n}</p>
        </div>
      )}
    </div>
  );
}

function MiniOverview({
  frames,
  current,
  spans,
  onJump,
}: {
  frames: TimelineFrame[];
  current: number;
  spans: ProblemSpan[];
  onJump: (n: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const layout = useMemo(() => layoutExposureStrip(frames, 8), [frames]);
  const n = Math.max(1, layout.totalTicks);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#16161a";
    ctx.fillRect(0, 0, w, h);
    const xOf = (tick: number) => (tick / n) * w;
    const byFrame = new Map(layout.cells.map((cell) => [cell.frameNumber, cell]));
    ctx.fillStyle = "rgba(142,160,181,0.35)";
    const step = Math.max(1, Math.ceil(layout.cells.length / w));
    for (let i = 0; i < layout.cells.length; i += step) {
      const cell = layout.cells[i]!;
      const type = frames[cell.drawingIndex]?.frameType;
      if (type === "GENERATED" || type === "REPAIRED") {
        ctx.fillRect(xOf(cell.startTick), 10, Math.max(1, (cell.ticks / n) * w), 6);
      }
    }
    ctx.fillStyle = "rgba(196,165,116,0.7)";
    for (const s of spans) {
      const a = byFrame.get(s.start);
      const b = byFrame.get(s.end);
      if (!a) continue;
      const start = a.startTick;
      const end = (b ?? a).startTick + (b ?? a).ticks;
      ctx.fillRect(xOf(start), 4, Math.max(2, xOf(end) - xOf(start)), h - 8);
    }
    ctx.fillStyle = "#d7d2c8";
    for (let i = 0; i < layout.cells.length; i += step) {
      const cell = layout.cells[i]!;
      if (frames[cell.drawingIndex]?.frameType === "KEY") {
        ctx.fillRect(xOf(cell.startTick), 2, 2, h - 4);
      }
    }
    ctx.fillStyle = "#f4f4f5";
    const cur = byFrame.get(current);
    ctx.fillRect(xOf(cur?.startTick ?? current), 0, 2, h);
  }, [layout, current, spans, frames, n]);

  return (
    <button
      type="button"
      className="block h-4 w-full border-b border-border"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const t = (e.clientX - r.left) / r.width;
        const tick = Math.round(t * (n - 1));
        const idx = cellIndexAtX(
          layout.cells.map((c) => ({ left: c.startTick, width: c.ticks })),
          tick,
        );
        onJump(layout.cells[idx]?.frameNumber ?? drawingAtTick(frames, tick)?.frameNumber ?? 0);
      }}
      aria-label="迷你時間軸"
    >
      <canvas ref={ref} width={640} height={16} className="h-4 w-full" />
    </button>
  );
}

export function SpacingStrip({
  dots,
  caption,
}: {
  dots: number[];
  caption: string;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-1 text-[11px] text-muted">
      <span className="w-32 shrink-0 text-faint">{caption}</span>
      <div className="relative h-4 flex-1">
        <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
        {dots.map((d, i) => (
          <span
            key={`${d}-${i}`}
            className="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg"
            style={{ left: `${d * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}
