/** Animation Analysis Canvas — pan/zoom/onion/pose/motion/track/problems/AI pointer. */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  drawAiPointer,
  drawAnnotations,
  drawContact,
  drawMotionPath,
  drawOnionTrail,
  drawPoseSkeleton,
  drawSampledFlow,
  drawFlowPaths,
  drawProblemBubble,
  drawRegionOutline,
  hitAnnotation,
  hitProblemBubble,
  inferContact,
  motionPathPoints,
  pickTrailName,
  type PoseJoint,
  type TrackSample,
} from "@/lib/visual/overlay-renderer";
import { computeViewport, enterFrameSpace, frameToView, leaveFrameSpace, panToNormRegion, viewToFrame, type ViewportTransform, zoom100Percent } from "@/lib/visual/viewport";
import type { CompareMode, OverlayStack, TrailTarget } from "@/lib/visual/workspace-mode";
import { activeOverlays } from "@/lib/visual/workspace-mode";
import { neighborIds } from "@/lib/visual/thumbnail-cache";
import type { VisualAnnotation } from "@/lib/domain/visual-annotation";
import { onionNeighbors } from "@/lib/domain/timeline-engine";
import type { TimelineEngineState } from "@/lib/domain/types";
import { regionBoxFromDrag, isUsableRegionBox } from "@/lib/visual/region-box";
import { cn } from "@/lib/utils";

import { jpegUrl } from "@/lib/visual/jpeg-url";
import {
  ONION_TINT_NEXT,
  ONION_TINT_PREV,
  onionAlpha,
  onionShouldShow,
} from "@/lib/visual/onion-draw";
import {
  BRUSH_COLOR,
  ERASER_COLOR,
  MAX_DRAW_UNDOS,
  isDrawTool,
  jpegFromDataUrl,
  shouldPanPointer,
  strokeWidth,
} from "@/lib/visual/draw-canvas";

export type CanvasTool = "pan" | "region" | "point" | "character" | "brush" | "eraser";

export type StudioFrame = {
  id: string;
  frameNumber: number;
  width: number;
  height: number;
  thumbnailData?: string;
  isLocked?: boolean;
};

export type MaskProp = { frame: number; mask: { x: number; y: number; w: number; h: number }; lost?: boolean };

export function AnimationCanvas({
  frames,
  imageMap,
  engine,
  overlay,
  consMap,
  tracking,
  poses,
  flowGrid,
  flowPaths,
  annotations,
  pixelView,
  regionBox,
  regionLive = false,
  tool,
  trailTarget,
  selectedJoint,
  compareFrame,
  flickerOn,
  compareMode = "flicker",
  holdCompare = false,
  candidatePreview,
  compareSources,
  revisionPreview,
  maskTrack,
  focusRegion,
  focusTick,
  onZoom,
  onPlacePoint,
  onRegion,
  onAnnotationClick,
  onProblemBubble,
  onViewport,
  onPanChange,
  fitTick,
  brushSize = 8,
  drawAction = null,
  onPaintCommit,
  onDrawState,
  onLockedDraw,
  onDrawActionConsumed,
}: {
  frames: StudioFrame[];
  imageMap: Map<string, string>;
  engine: TimelineEngineState;
  overlay: OverlayStack;
  consMap: Map<number, { severity: string }>;
  tracking: TrackSample[];
  poses: { frame_number: number; joints_json: string }[];
  flowGrid?: { x: number; y: number; dx: number; dy: number; mag: number }[];
  flowPaths?: { x: number; y: number }[][];
  annotations: VisualAnnotation[];
  pixelView: boolean;
  regionBox: { x: number; y: number; w: number; h: number };
  regionLive?: boolean;
  tool: CanvasTool;
  trailTarget: TrailTarget;
  selectedJoint: string | null;
  compareFrame: number | null;
  flickerOn: boolean;
  compareMode?: CompareMode;
  holdCompare?: boolean;
  candidatePreview?: { frameNumber: number; data: string } | null;
  compareSources?: {
    original?: string | null;
    candidate?: string | null;
    previous?: string | null;
  } | null;
  revisionPreview?: { frameNumber: number; data: string } | null;
  maskTrack?: MaskProp[];
  focusRegion?: { x: number; y: number; w: number; h: number } | null;
  focusTick: number;
  onZoom: (z: number) => void;
  onPlacePoint: (x: number, y: number) => void;
  onRegion: (box: { x: number; y: number; w: number; h: number }) => void;
  onAnnotationClick?: (a: VisualAnnotation) => void;
  onProblemBubble?: () => void;
  onViewport?: (vt: ViewportTransform) => void;
  onPanChange?: (p: { x: number; y: number }) => void;
  fitTick: number;
  brushSize?: number;
  drawAction?: { n: number; type: "undo" | "redo" } | null;
  onPaintCommit?: (frameId: string, imageData: string) => void;
  onDrawState?: (s: { canUndo: boolean; canRedo: boolean }) => void;
  onLockedDraw?: () => void;
  onDrawActionConsumed?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pan = useRef({ x: 0, y: 0, px: 0, py: 0, dragging: false, moved: 0, region: false, rx: 0, ry: 0 });
  const [panState, setPan] = useState({ x: 0, y: 0 });
  const [dragBox, setDragBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [pulse, setPulse] = useState(0);
  const vtRef = useRef<ViewportTransform | null>(null);
  const bubbleRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const cache = useRef(new Map<string, HTMLImageElement>());
  const layers = activeOverlays(overlay);
  const paintMap = useRef(
    new Map<string, { canvas: HTMLCanvasElement; undo: string[]; redo: string[] }>(),
  );
  const draw = useRef({
    active: false,
    pointerId: -1,
    lastX: 0,
    lastY: 0,
    moved: 0,
    pointers: new Map<number, { x: number; y: number }>(),
  });
  const [paintTick, setPaintTick] = useState(0);
  const bumpPaint = () => setPaintTick((n) => n + 1);

  const emitDrawState = (frameId: string) => {
    const s = paintMap.current.get(frameId);
    onDrawState?.({ canUndo: Boolean(s && s.undo.length), canRedo: Boolean(s && s.redo.length) });
  };

  const commitPaint = (frameId: string) => {
    const s = paintMap.current.get(frameId);
    if (!s || !onPaintCommit) return;
    onPaintCommit(frameId, jpegFromDataUrl(s.canvas.toDataURL("image/jpeg", 0.88)));
    emitDrawState(frameId);
  };

  const paintOnto = (sessionCanvas: HTMLCanvasElement, src: string) =>
    new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const ctx = sessionCanvas.getContext("2d");
        if (ctx) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, sessionCanvas.width, sessionCanvas.height);
          ctx.drawImage(img, 0, 0, sessionCanvas.width, sessionCanvas.height);
        }
        resolve();
      };
      img.onerror = () => resolve();
      img.src = jpegUrl(src);
    });

  const bootSession = async (frame: StudioFrame) => {
    const existing = paintMap.current.get(frame.id);
    if (existing) return existing;
    const img = new Image();
    const full = `/api/frame-assets?frameId=${encodeURIComponent(frame.id)}&tier=full`;
    img.src = full;
    try {
      await img.decode();
    } catch {
      const data = imageMap.get(frame.id);
      if (!data) return null;
      img.src = jpegUrl(data);
      try {
        await img.decode();
      } catch {
        return null;
      }
    }
    const c = document.createElement("canvas");
    c.width = Math.max(1, frame.width);
    c.height = Math.max(1, frame.height);
    const cctx = c.getContext("2d");
    if (!cctx) return null;
    cctx.drawImage(img, 0, 0, c.width, c.height);
    const s = { canvas: c, undo: [] as string[], redo: [] as string[] };
    paintMap.current.set(frame.id, s);
    return s;
  };

  const strokeTo = (frame: StudioFrame, x: number, y: number, pressure: number) => {
    const s = paintMap.current.get(frame.id);
    const ctx = s?.canvas.getContext("2d");
    if (!s || !ctx) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = tool === "eraser" ? ERASER_COLOR : BRUSH_COLOR;
    ctx.globalCompositeOperation = "source-over";
    ctx.lineWidth = strokeWidth(brushSize, pressure);
    ctx.beginPath();
    ctx.moveTo(draw.current.lastX, draw.current.lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    draw.current.lastX = x;
    draw.current.lastY = y;
    draw.current.moved += 1;
    bumpPaint();
  };

  const applyHistory = async (frame: StudioFrame, type: "undo" | "redo") => {
    const s = paintMap.current.get(frame.id) ?? (await bootSession(frame));
    if (!s) return;
    const stack = type === "undo" ? s.undo : s.redo;
    const other = type === "undo" ? s.redo : s.undo;
    const prev = stack.pop();
    if (!prev) {
      emitDrawState(frame.id);
      return;
    }
    other.push(s.canvas.toDataURL("image/jpeg", 0.88));
    if (other.length > MAX_DRAW_UNDOS) other.shift();
    await paintOnto(s.canvas, prev);
    bumpPaint();
    commitPaint(frame.id);
  };

  const load = useCallback((id: string, b64: string) => {
    const existing = cache.current.get(id);
    if (existing && existing.dataset.hash === b64.slice(0, 24)) return existing;
    const img = new Image();
    img.dataset.hash = b64.slice(0, 24);
    img.src = jpegUrl(b64);
    cache.current.set(id, img);
    return img;
  }, []);

  useEffect(() => {
    const ids = neighborIds(frames, engine.currentFrame, 4);
    for (const id of ids) {
      const data = imageMap.get(id);
      if (data) load(id, data);
    }
  }, [frames, engine.currentFrame, imageMap, load]);

  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [fitTick]);

  useEffect(() => {
    if (!focusRegion || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const current = frames.find((f) => f.frameNumber === engine.currentFrame);
    if (!current) return;
    const p = panToNormRegion({
      viewWidth: rect.width,
      viewHeight: rect.height,
      frameWidth: current.width,
      frameHeight: current.height,
      zoom: engine.zoom,
      region: focusRegion,
    });
    setPan({ x: p.panX, y: p.panY });
    onPanChange?.({ x: p.panX, y: p.panY });
  }, [focusTick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = window.setInterval(() => setPulse((p) => p + 0.18), 80);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = wrap.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const current = frames.find((f) => f.frameNumber === engine.currentFrame);
    if (!current) return;
    const src =
      revisionPreview && revisionPreview.frameNumber === current.frameNumber
        ? revisionPreview.data
        : candidatePreview && candidatePreview.frameNumber === current.frameNumber
          ? candidatePreview.data
          : imageMap.get(current.id);

    const vt = computeViewport({
      viewWidth: rect.width,
      viewHeight: rect.height,
      frameWidth: current.width,
      frameHeight: current.height,
      zoom: engine.zoom,
      panX: panState.x,
      panY: panState.y,
    });
    vtRef.current = vt;
    onViewport?.(vt);
    const { dx, dy, scale } = vt;
    const fw = current.width;
    const fh = current.height;

    const blit = (
      im: CanvasImageSource,
      alpha: number,
      tint?: string,
    ) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(im, 0, 0, fw, fh);
      if (tint) {
        ctx.globalCompositeOperation = "source-atop";
        ctx.fillStyle = tint;
        ctx.fillRect(0, 0, fw, fh);
      }
      ctx.restore();
    };

    const drawFrame = (frameNumber: number, alpha: number, tint?: string, dest?: { x: number; y: number; w: number; h: number }) => {
      const f = frames.find((x) => x.frameNumber === frameNumber);
      const data =
        candidatePreview && candidatePreview.frameNumber === frameNumber
          ? candidatePreview.data
          : f
            ? imageMap.get(f.id)
            : undefined;
      const x = dest?.x ?? dx;
      const y = dest?.y ?? dy;
      const w = dest?.w ?? fw * scale;
      const h = dest?.h ?? fh * scale;
      if (!data) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "rgba(20,20,22,0.9)";
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = "#71717a";
        ctx.font = "11px sans-serif";
        ctx.fillText("空", x + 8, y + 16);
        ctx.restore();
        return;
      }
      const im = load(
        candidatePreview && candidatePreview.frameNumber === frameNumber ? `cand-${frameNumber}` : f?.id ?? String(frameNumber),
        data,
      );
      if (!im.complete) {
        im.onload = () => setPan((p) => ({ ...p }));
        return;
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(im, x, y, w, h);
      if (tint) {
        ctx.globalCompositeOperation = "source-atop";
        ctx.fillStyle = tint;
        ctx.fillRect(x, y, w, h);
      }
      ctx.restore();
    };

    const drawFramePx = (frameNumber: number, alpha: number, tint?: string) => {
      const f = frames.find((x) => x.frameNumber === frameNumber);
      const data =
        candidatePreview && candidatePreview.frameNumber === frameNumber
          ? candidatePreview.data
          : f
            ? imageMap.get(f.id)
            : undefined;
      if (!data) return;
      const im = load(
        candidatePreview && candidatePreview.frameNumber === frameNumber ? `cand-${frameNumber}` : f?.id ?? String(frameNumber),
        data,
      );
      if (!im.complete) {
        im.onload = () => setPan((p) => ({ ...p }));
        return;
      }
      blit(im, alpha, tint);
    };

    const onion = onionNeighbors(engine.currentFrame, engine.frameCount, engine.onionSkin);
    const showCompare = overlay.primary === "compare" && (compareFrame != null || Boolean(compareSources));
    const showOnion = onionShouldShow({ enabled: engine.onionSkin.enabled, compareActive: showCompare });
    const hold = holdCompare && compareFrame != null;

    if (showCompare && compareMode === "side") {
      const halfW = current.width * scale * (compareSources?.previous ? 0.31 : 0.48);
      const halfH = current.height * scale * (compareSources?.previous ? 0.31 : 0.48);
      const y = dy + current.height * scale * 0.28;
      const drawSrc = (data: string | null | undefined, x: number, label: string) => {
        ctx.save();
        ctx.fillStyle = "rgba(20,20,22,0.9)";
        ctx.fillRect(x, y, halfW, halfH);
        if (data) {
          const im = load(`cmp-${label}-${engine.currentFrame}`, data);
          if (im.complete) ctx.drawImage(im, x, y, halfW, halfH);
          else im.onload = () => setPan((p) => ({ ...p }));
        } else {
          ctx.fillStyle = "#71717a";
          ctx.font = "11px sans-serif";
          ctx.fillText("空", x + 8, y + 16);
        }
        ctx.fillStyle = "#a1a1aa";
        ctx.font = "11px sans-serif";
        ctx.fillText(label, x, y - 6);
        ctx.restore();
      };
      if (compareSources && (compareSources.original || compareSources.candidate || compareSources.previous)) {
        let x = dx;
        drawSrc(compareSources.original ?? imageMap.get(current.id), x, "原圖");
        x += halfW + 8;
        drawSrc(compareSources.candidate ?? null, x, "候選");
        if (compareSources.previous) {
          x += halfW + 8;
          drawSrc(compareSources.previous, x, "上一版");
        }
        return;
      }
      const left = compareFrame ?? Math.max(0, engine.currentFrame - 1);
      drawFrame(left, 1, undefined, { x: dx, y, w: halfW, h: halfH });
      drawFrame(engine.currentFrame, 1, undefined, { x: dx + halfW + 8, y, w: halfW, h: halfH });
      ctx.fillStyle = "#a1a1aa";
      ctx.font = "11px sans-serif";
      ctx.fillText(`F${left} 前`, dx, y - 6);
      ctx.fillText(`F${engine.currentFrame} 後`, dx + halfW + 8, y - 6);
      return;
    }

    const displayNum =
      flickerOn && compareFrame != null
        ? Math.floor(pulse * 4) % 2 === 0
          ? compareFrame
          : engine.currentFrame
        : hold && compareFrame != null
          ? compareFrame
          : engine.currentFrame;
    const display = frames.find((f) => f.frameNumber === displayNum) ?? current;
    const displaySrc =
      candidatePreview && candidatePreview.frameNumber === displayNum
        ? candidatePreview.data
        : imageMap.get(display.id) ?? src;
    const img = displaySrc
      ? load(
          candidatePreview && candidatePreview.frameNumber === displayNum ? `cand-${displayNum}` : display.id,
          displaySrc,
        )
      : null;
    if (img && !img.complete) {
      img.onload = () => setPan((p) => ({ ...p }));
    }

    enterFrameSpace(ctx, vt, dpr);
    ctx.imageSmoothingEnabled = !pixelView && engine.zoom < 2;
    if (showOnion) {
      onion.prev.forEach((n, i) => {
        drawFramePx(n, onionAlpha("prev", i, onion.prev.length, engine.onionSkin.opacityPrev), ONION_TINT_PREV);
      });
    }
    const live = paintMap.current.get(display.id);
    if (live) blit(live.canvas, 1);
    else if (img?.complete) blit(img, 1);
    if (showCompare && compareMode === "overlay" && compareFrame != null) {
      drawFramePx(compareFrame, 0.45);
    }
    if (showOnion) {
      onion.next.forEach((n, i) => {
        drawFramePx(n, onionAlpha("next", i, onion.next.length, engine.onionSkin.opacityNext), ONION_TINT_NEXT);
      });
    }
    leaveFrameSpace(ctx, dpr);

    const prev = frames.find((f) => f.frameNumber === engine.currentFrame - 1);
    const wantDiff = layers.has("diff") || compareMode === "diff" || overlay.primary === "compare";
    if (img?.complete && wantDiff && prev && imageMap.get(prev.id) && overlay.primary !== "compare") {
      paintDiff(ctx, load(prev.id, imageMap.get(prev.id)!), img, dx, dy, current.width * scale, current.height * scale, "diff");
    }
    if (img?.complete && showCompare && compareMode === "diff" && compareFrame != null) {
      const other = frames.find((f) => f.frameNumber === compareFrame);
      if (other && imageMap.get(other.id)) {
        paintDiff(ctx, load(other.id, imageMap.get(other.id)!), img, dx, dy, current.width * scale, current.height * scale, "diff");
      }
    }
    if (img?.complete && (layers.has("heatmap") || overlay.primary === "motion")) {
      if (prev && imageMap.get(prev.id)) {
        paintDiff(ctx, load(prev.id, imageMap.get(prev.id)!), img, dx, dy, current.width * scale, current.height * scale, "motion");
      }
    }
    if (layers.has("flow") || overlay.primary === "motion") {
      if (flowGrid && flowGrid.length) {
        drawSampledFlow(ctx, vt, flowGrid);
      } else if (prev && imageMap.get(prev.id) && img?.complete) {
        paintFlow(ctx, load(prev.id, imageMap.get(prev.id)!), img, dx, dy, current.width * scale, current.height * scale);
      }
      if (flowPaths && flowPaths.length) {
        drawFlowPaths(ctx, vt, flowPaths);
      }
    }

    const parsePose = (n: number): PoseJoint[] => {
      const row = poses.find((p) => p.frame_number === n);
      if (!row) return [];
      try {
        const raw = JSON.parse(row.joints_json) as PoseJoint[];
        return Array.isArray(raw) ? raw : [];
      } catch {
        return [];
      }
    };

    if (layers.has("pose") || overlay.primary === "pose") {
      const ghostPrev = parsePose(engine.currentFrame - 1);
      const ghostNext = parsePose(engine.currentFrame + 1);
      if (ghostPrev.length) drawPoseSkeleton(ctx, vt, ghostPrev, { ghost: "prev" });
      if (ghostNext.length) drawPoseSkeleton(ctx, vt, ghostNext, { ghost: "next" });
      const now = parsePose(engine.currentFrame);
      if (now.length) drawPoseSkeleton(ctx, vt, now, { selected: selectedJoint, dimUnselected: Boolean(selectedJoint) });
    }

    const trailName = pickTrailName(tracking, trailTarget);
    if (trailName && (layers.has("track") || overlay.primary === "track" || overlay.primary === "motion" || showOnion)) {
      const pts = motionPathPoints(tracking, vt, trailName);
      if (layers.has("track") || overlay.primary === "track" || overlay.primary === "motion") {
        drawMotionPath(ctx, pts, engine.currentFrame);
      }
      if (showOnion) drawOnionTrail(ctx, pts, engine.currentFrame, Math.max(engine.onionSkin.prev, engine.onionSkin.next, 2));
    }

    const contact = inferContact(tracking, engine.currentFrame, current.width, current.height);
    if (contact && (layers.has("track") || layers.has("problems") || overlay.primary === "track" || overlay.primary === "problems")) {
      drawContact(ctx, vt, contact);
    }

    bubbleRef.current = null;
    if (layers.has("problems") || overlay.primary === "problems") {
      const sev = consMap.get(engine.currentFrame)?.severity;
      if (sev && sev !== "ok") {
        ctx.fillStyle = sev === "error" || sev === "critical" ? "rgba(196,120,120,0.12)" : "rgba(196,165,116,0.1)";
        ctx.fillRect(dx, dy, current.width * scale, current.height * scale);
        const label =
          annotations.find((a) => a.frame_number === engine.currentFrame && a.type !== "RANGE")?.label ??
          "這一格有問題";
        bubbleRef.current = drawProblemBubble(ctx, dx + current.width * scale * 0.58, dy + 12, label);
      }
    }

    const maskHere = maskTrack?.find((m) => m.frame === engine.currentFrame);
    if (regionLive && (layers.has("mask") || overlay.primary === "mask" || tool === "region") && !maskHere) {
      drawRegionOutline(ctx, vt, regionBox, { label: "選區", fill: true });
    }
    if (maskHere) {
      drawRegionOutline(ctx, vt, maskHere.mask, {
        label: maskHere.lost ? "遮罩遺失" : "遮罩",
        tone: maskHere.lost ? "rgba(196,120,120,0.95)" : "rgba(155,176,160,0.9)",
        fill: true,
      });
    }
    if (dragBox) drawRegionOutline(ctx, vt, dragBox, { tone: "rgba(200,204,212,0.9)" });

    drawAnnotations(ctx, vt, annotations, engine.currentFrame, pulse);
    const aiPoint = annotations.find((a) => a.frame_number === engine.currentFrame && a.type === "POINT" && a.source === "ai");
    if (aiPoint && aiPoint.coordinates.length >= 2 && overlay.primary !== "problems") {
      drawAiPointer(ctx, vt, aiPoint.coordinates[0], aiPoint.coordinates[1], aiPoint.label || "這裡", pulse);
    }

    const pts = tracking.filter((p) => p.frame_number === engine.currentFrame);
    if (layers.has("track") || overlay.primary === "track") {
      for (const p of pts) {
        const px = p.x <= 1 && p.y <= 1 ? p.x * current.width : p.x;
        const py = p.x <= 1 && p.y <= 1 ? p.y * current.height : p.y;
        const v = frameToView(vt, px, py);
        ctx.beginPath();
        ctx.strokeStyle = p.status === "lost" ? "#c47878" : "#c8ccd4";
        ctx.lineWidth = 1.5;
        ctx.arc(v.x, v.y, 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#c8ccd4";
        ctx.font = "10px sans-serif";
        ctx.fillText(p.name, v.x + 8, v.y - 6);
      }
    }
  }, [
    frames,
    imageMap,
    engine,
    overlay,
    consMap,
    tracking,
    poses,
    flowGrid,
    flowPaths,
    annotations,
    panState,
    fitTick,
    load,
    pixelView,
    regionBox,
    regionLive,
    dragBox,
    trailTarget,
    selectedJoint,
    compareFrame,
    flickerOn,
    compareMode,
    holdCompare,
    candidatePreview,
    compareSources,
    revisionPreview,
    tool,
    onViewport,
    layers,
    pulse,
    maskTrack,
    paintTick,
  ]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1 / 1.08 : 1.08;
      onZoom(engine.zoom * factor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [engine.zoom, onZoom]);

  useEffect(() => {
    const current = frames.find((f) => f.frameNumber === engine.currentFrame);
    if (current) emitDrawState(current.id);
    else onDrawState?.({ canUndo: false, canRedo: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.currentFrame]);

  useEffect(() => {
    if (!drawAction) return;
    const current = frames.find((f) => f.frameNumber === engine.currentFrame);
    if (current) void applyHistory(current, drawAction.type);
    onDrawActionConsumed?.();
    // applyHistory closes over boot/commit; run only when the parent ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawAction?.n]);

  const frameAt = (clientX: number, clientY: number) => {
    const wrap = wrapRef.current;
    const vt = vtRef.current;
    if (!wrap || !vt) return null;
    const rect = wrap.getBoundingClientRect();
    return viewToFrame(vt, clientX - rect.left, clientY - rect.top);
  };

  const endStroke = (frame?: StudioFrame) => {
    if (!draw.current.active) return;
    const moved = draw.current.moved;
    draw.current.active = false;
    draw.current.pointerId = -1;
    if (!frame) return;
    const s = paintMap.current.get(frame.id);
    if (!s) return;
    if (moved < 1) {
      s.undo.pop();
      emitDrawState(frame.id);
      return;
    }
    commitPaint(frame.id);
  };

  return (
    <div
      ref={wrapRef}
      className={cn(
        "film-check relative min-h-0 flex-1 touch-none",
        tool === "region" || isDrawTool(tool) ? "cursor-crosshair" : "cursor-grab",
      )}
      onPointerDown={(e) => {
        const current = frames.find((f) => f.frameNumber === engine.currentFrame);
        draw.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const panInstead = shouldPanPointer({
          tool,
          button: e.button,
          altKey: e.altKey,
          pointerCount: draw.current.pointers.size,
        });
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        if (!panInstead && isDrawTool(tool) && current) {
          e.preventDefault();
          if (current.isLocked) {
            onLockedDraw?.();
            return;
          }
          const at = frameAt(e.clientX, e.clientY);
          if (!at) return;
          const pointerId = e.pointerId;
          const pressure = e.pressure;
          void bootSession(current).then((s) => {
            if (!s || !draw.current.pointers.has(pointerId)) return;
            s.undo.push(s.canvas.toDataURL("image/jpeg", 0.88));
            if (s.undo.length > MAX_DRAW_UNDOS) s.undo.shift();
            s.redo = [];
            draw.current.active = true;
            draw.current.pointerId = pointerId;
            draw.current.lastX = at.x;
            draw.current.lastY = at.y;
            draw.current.moved = 0;
            strokeTo(current, at.x, at.y, pressure);
          });
          return;
        }
        if (draw.current.active && current) endStroke(current);
        const vt = vtRef.current;
        pan.current = {
          ...pan.current,
          dragging: true,
          px: e.clientX,
          py: e.clientY,
          moved: 0,
          region: tool === "region" && e.button === 0 && !e.altKey,
          rx: e.clientX,
          ry: e.clientY,
        };
        if (pan.current.region && vt) {
          const wrap = wrapRef.current;
          if (!wrap) return;
          const rect = wrap.getBoundingClientRect();
          const f = viewToFrame(vt, e.clientX - rect.left, e.clientY - rect.top);
          pan.current.rx = f.x;
          pan.current.ry = f.y;
        }
      }}
      onPointerMove={(e) => {
        const pt = draw.current.pointers.get(e.pointerId);
        if (pt) draw.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const current = frames.find((f) => f.frameNumber === engine.currentFrame);
        if (draw.current.active && draw.current.pointerId === e.pointerId && current && draw.current.pointers.size === 1) {
          const at = frameAt(e.clientX, e.clientY);
          if (!at) return;
          strokeTo(current, at.x, at.y, e.pressure);
          return;
        }
        if (!pan.current.dragging) return;
        const dx = e.clientX - pan.current.px;
        const dy = e.clientY - pan.current.py;
        pan.current.px = e.clientX;
        pan.current.py = e.clientY;
        pan.current.moved += Math.abs(dx) + Math.abs(dy);
        if (pan.current.region) {
          const wrap = wrapRef.current;
          const vt = vtRef.current;
          if (!wrap || !vt || !current) return;
          const rect = wrap.getBoundingClientRect();
          const f = viewToFrame(vt, e.clientX - rect.left, e.clientY - rect.top);
          setDragBox(regionBoxFromDrag(pan.current.rx, pan.current.ry, f.x, f.y, current.width, current.height));
          return;
        }
        setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
      }}
      onPointerUp={(e) => {
        draw.current.pointers.delete(e.pointerId);
        const current = frames.find((f) => f.frameNumber === engine.currentFrame);
        if (draw.current.active && (draw.current.pointerId === e.pointerId || draw.current.pointerId === -1)) {
          endStroke(current);
          return;
        }
        const moved = pan.current.moved;
        const wasRegion = pan.current.region;
        pan.current.dragging = false;
        pan.current.region = false;
        if (wasRegion && dragBox && isUsableRegionBox(dragBox)) {
          onRegion(dragBox);
          setDragBox(null);
          return;
        }
        setDragBox(null);
        if (moved > 6) return;
        if (isDrawTool(tool)) return;
        const wrap = wrapRef.current;
        const vt = vtRef.current;
        if (!wrap || !current || !vt) return;
        const rect = wrap.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        if (hitProblemBubble(bubbleRef.current, px, py)) {
          onProblemBubble?.();
          return;
        }
        const hit = hitAnnotation(vt, annotations, engine.currentFrame, px, py);
        if (hit && onAnnotationClick) {
          onAnnotationClick(hit);
          return;
        }
        const f = viewToFrame(vt, px, py);
        if (f.x < 0 || f.y < 0 || f.x > current.width || f.y > current.height) return;
        onPlacePoint(f.x, f.y);
      }}
      onPointerCancel={(e) => {
        draw.current.pointers.delete(e.pointerId);
        const current = frames.find((f) => f.frameNumber === engine.currentFrame);
        endStroke(current);
        pan.current.dragging = false;
        pan.current.region = false;
        setDragBox(null);
      }}
      onPointerLeave={() => {
        if (!draw.current.active) pan.current.dragging = false;
      }}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}

export function fitZoom100(viewW: number, viewH: number, fw: number, fh: number) {
  return zoom100Percent(viewW, viewH, fw, fh);
}

function paintFlow(
  ctx: CanvasRenderingContext2D,
  a: HTMLImageElement,
  b: HTMLImageElement,
  dx: number,
  dy: number,
  w: number,
  h: number,
) {
  if (!a.complete || !b.complete) return;
  const gw = 80;
  const gh = 45;
  const off = document.createElement("canvas");
  off.width = gw;
  off.height = gh;
  const o = off.getContext("2d");
  if (!o) return;
  o.drawImage(a, 0, 0, gw, gh);
  const A = o.getImageData(0, 0, gw, gh).data;
  o.drawImage(b, 0, 0, gw, gh);
  const B = o.getImageData(0, 0, gw, gh).data;
  const block = 8;
  const search = 4;
  const sad = (ax: number, ay: number, bx: number, by: number) => {
    if (bx < 0 || by < 0 || bx + block > gw || by + block > gh) return Infinity;
    let s = 0;
    for (let j = 0; j < block; j += 2) {
      for (let i = 0; i < block; i += 2) {
        const ai = ((ay + j) * gw + (ax + i)) * 4;
        const bi = ((by + j) * gw + (bx + i)) * 4;
        s += Math.abs(A[ai] - B[bi]) + Math.abs(A[ai + 1] - B[bi + 1]) + Math.abs(A[ai + 2] - B[bi + 2]);
      }
    }
    return s;
  };
  ctx.save();
  ctx.strokeStyle = "rgba(180, 200, 220, 0.85)";
  ctx.lineWidth = 1;
  for (let y = block; y + block < gh; y += block) {
    for (let x = block; x + block < gw; x += block) {
      let best = Infinity;
      let bdx = 0;
      let bdy = 0;
      for (let dyb = -search; dyb <= search; dyb += 2) {
        for (let dxb = -search; dxb <= search; dxb += 2) {
          const err = sad(x, y, x + dxb, y + dyb);
          if (err < best) {
            best = err;
            bdx = dxb;
            bdy = dyb;
          }
        }
      }
      if (bdx === 0 && bdy === 0) continue;
      const sx = dx + (x / gw) * w;
      const sy = dy + (y / gh) * h;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + (bdx / gw) * w * 1.8, sy + (bdy / gh) * h * 1.8);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function paintDiff(
  ctx: CanvasRenderingContext2D,
  a: HTMLImageElement,
  b: HTMLImageElement,
  dx: number,
  dy: number,
  w: number,
  h: number,
  mode: "diff" | "motion",
) {
  if (!a.complete || !b.complete) return;
  const off = document.createElement("canvas");
  off.width = 160;
  off.height = 90;
  const o = off.getContext("2d");
  if (!o) return;
  o.drawImage(a, 0, 0, 160, 90);
  const A = o.getImageData(0, 0, 160, 90).data;
  o.drawImage(b, 0, 0, 160, 90);
  const B = o.getImageData(0, 0, 160, 90).data;
  const out = o.createImageData(160, 90);
  for (let i = 0; i < A.length; i += 4) {
    const d = (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2])) / 3;
    if (mode === "motion") {
      const t = Math.min(1, d / 48);
      out.data[i] = Math.round(40 + t * 180);
      out.data[i + 1] = Math.round(36 + t * 90);
      out.data[i + 2] = Math.round(40 + (1 - t) * 30);
    } else {
      out.data[i] = out.data[i + 1] = out.data[i + 2] = Math.min(255, d * 2.2);
    }
    out.data[i + 3] = 200;
  }
  o.putImageData(out, 0, 0);
  ctx.drawImage(off, dx, dy, w, h);
}
