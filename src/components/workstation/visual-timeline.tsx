/** Virtualized timeline with thumbnails, frame types, problem ranges, hover preview. */

import { useEffect, useMemo, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { padFrame } from "@/lib/domain/types";
import type { TimelineEngineState } from "@/lib/domain/types";
import {
  cellWidthForZoom,
  frameAtX,
  frameTypeMark,
  mergeProblemSpans,
  timelineWindow,
  keyBreakdownFlow,
  type ProblemSpan,
} from "@/lib/visual/timeline-virtual";
import { cn } from "@/lib/utils";

import { jpegUrl } from "@/lib/visual/jpeg-url";

export type TimelineFrame = {
  id: string;
  frameNumber: number;
  frameType: string;
  thumbnailData: string;
  isLocked?: boolean;
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
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<{ n: number; x: number; src: string } | null>(null);
  const dragging = useRef(false);
  const cell = cellWidthForZoom(timelineZoom);
  const win = timelineWindow({
    scrollLeft,
    containerWidth: width,
    cellWidth: cell,
    total: frames.length,
  });

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const x = engine.currentFrame * cell - width / 2 + cell / 2;
    if (!dragging.current && Math.abs(el.scrollLeft - x) > cell * 4) el.scrollTo({ left: Math.max(0, x) });
  }, [engine.currentFrame, cell, width]);

  const spans = useMemo(
    () => mergeProblemSpans(problemRanges as ProblemSpan[]),
    [problemRanges],
  );
  const slice = frames.slice(win.start, win.end);
  const flow = useMemo(() => keyBreakdownFlow(frames), [frames]);
  const maskBy = useMemo(() => new Map((maskTrack ?? []).map((m) => [m.frame, m.status])), [maskTrack]);

  function frameFromClientX(clientX: number) {
    const el = scroller.current;
    if (!el) return 0;
    const x = el.scrollLeft + (clientX - el.getBoundingClientRect().left);
    return frameAtX(x, cell, frames.length);
  }

  return (
    <div className="shrink-0 border-t border-border bg-surface">
      <MiniOverview
        frames={frames}
        current={engine.currentFrame}
        spans={spans}
        keys={frames.filter((f) => f.frameType === "KEY").map((f) => f.frameNumber)}
        generated={frames.filter((f) => f.frameType === "GENERATED" || f.frameType === "REPAIRED").map((f) => f.frameNumber)}
        onJump={(n) => onSeek(n, false)}
      />
      <div className="flex items-center justify-between px-3 py-0.5 text-[11px] text-faint">
        <span className="truncate">
          時間軸
          {engine.loopRange ? ` · 循環 F${engine.loopRange[0]}–F${engine.loopRange[1]}` : ""}
          {highlightRange ? ` · F${highlightRange[0]}–F${highlightRange[1]}` : ""}
          {repairRange ? ` · 修復 F${repairRange[0]}–F${repairRange[1]}` : ""}
        </span>
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
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
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
        <div className="relative" style={{ width: win.totalWidth, height: 78 }}>
          {flow.map((f) =>
            f.nextKey == null ? null : (
              <div
                key={`flow-${f.key}-${f.nextKey}`}
                className="pointer-events-none absolute top-1 h-0.5 bg-key/40"
                style={{
                  left: f.key * cell + cell / 2,
                  width: Math.max(8, (f.nextKey - f.key) * cell),
                }}
                title={`★ F${f.key}${f.breakdown != null ? ` ◆ F${f.breakdown}` : ""} ★ F${f.nextKey}`}
              />
            ),
          )}
          {spans.map((s) => (
            <button
              key={`span-${s.start}-${s.end}`}
              type="button"
              title={`問題 F${s.start}–F${s.end}`}
              onClick={() => onSeek(s.start, false)}
              className="absolute top-0 h-full rounded-[var(--radius-xs)] bg-warn/15 ring-1 ring-warn/40"
              style={{
                left: s.start * cell,
                width: Math.max(cell, (s.end - s.start + 1) * cell),
              }}
            />
          ))}
          {repairRange && (
            <div
              className="pointer-events-none absolute top-0 h-full border border-repair/60 bg-repair/10"
              style={{
                left: repairRange[0] * cell,
                width: Math.max(cell, (repairRange[1] - repairRange[0] + 1) * cell),
              }}
            />
          )}
          {highlightRange && (
            <div
              className="pointer-events-none absolute bottom-0 h-1 bg-accent"
              style={{
                left: highlightRange[0] * cell,
                width: Math.max(cell, (highlightRange[1] - highlightRange[0] + 1) * cell),
              }}
            />
          )}
          <div className="absolute top-0" style={{ left: win.offset, display: "flex" }}>
            {slice.map((f) => {
              const active = f.frameNumber === engine.currentFrame;
              const selected = engine.selectedFrames.includes(f.frameNumber);
              const sev = consMap.get(f.frameNumber)?.severity;
              const mark = frameTypeMark(f.frameType);
              const talked = conversationFrames?.includes(f.frameNumber);
              const dim = dimFrames?.has(f.frameNumber);
              const mask = maskBy.get(f.frameNumber);
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
                    "relative shrink-0 overflow-hidden border",
                    active ? "border-accent" : selected ? "border-key/60" : "border-border",
                    dim && "opacity-35",
                  )}
                  style={{ width: cell - 2, height: 70, marginRight: 2 }}
                  title={`${padFrame(f.frameNumber)} ${mark.title}`}
                >
                  {f.thumbnailData ? (
                    <img
                      src={jpegUrl(f.thumbnailData)}
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
                      title={mask === "lost" ? "遮罩遺失" : "遮罩"}
                    />
                  )}
                </button>
              );
            })}
          </div>
          <div
            className="pointer-events-none absolute top-0 z-10 w-px bg-fg"
            style={{ left: engine.currentFrame * cell + cell / 2, height: 78 }}
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
  keys,
  generated,
  onJump,
}: {
  frames: TimelineFrame[];
  current: number;
  spans: ProblemSpan[];
  keys: number[];
  generated: number[];
  onJump: (n: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const n = Math.max(1, frames.length);
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
    const xOf = (frame: number) => (frame / n) * w;
    ctx.fillStyle = "rgba(142,160,181,0.35)";
    for (const g of generated) ctx.fillRect(xOf(g), 10, Math.max(1, w / n), 6);
    ctx.fillStyle = "rgba(196,165,116,0.7)";
    for (const s of spans) ctx.fillRect(xOf(s.start), 4, Math.max(2, xOf(s.end) - xOf(s.start) + 2), h - 8);
    ctx.fillStyle = "#d7d2c8";
    for (const k of keys) ctx.fillRect(xOf(k), 2, 2, h - 4);
    ctx.fillStyle = "#f4f4f5";
    ctx.fillRect(xOf(current), 0, 2, h);
  }, [frames.length, current, spans, keys, generated, n]);

  return (
    <button
      type="button"
      className="block h-4 w-full border-b border-border"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const t = (e.clientX - r.left) / r.width;
        onJump(Math.round(t * (n - 1)));
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
