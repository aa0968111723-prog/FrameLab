/** Unified frame ↔ viewport transform. All overlays go through this. */

export type ViewportTransform = {
  dx: number;
  dy: number;
  scale: number;
  frameWidth: number;
  frameHeight: number;
  viewWidth: number;
  viewHeight: number;
  zoom: number;
};

export function computeViewport(opts: {
  viewWidth: number;
  viewHeight: number;
  frameWidth: number;
  frameHeight: number;
  zoom: number;
  panX: number;
  panY: number;
  fitPad?: number;
}): ViewportTransform {
  const pad = opts.fitPad ?? 0.92;
  const fw = Math.max(1, opts.frameWidth);
  const fh = Math.max(1, opts.frameHeight);
  const fit = Math.min(opts.viewWidth / fw, opts.viewHeight / fh) * pad;
  const scale = Math.max(0.01, opts.zoom * fit);
  const dx = opts.viewWidth / 2 - (fw * scale) / 2 + opts.panX;
  const dy = opts.viewHeight / 2 - (fh * scale) / 2 + opts.panY;
  return {
    dx,
    dy,
    scale,
    frameWidth: fw,
    frameHeight: fh,
    viewWidth: opts.viewWidth,
    viewHeight: opts.viewHeight,
    zoom: opts.zoom,
  };
}

export function frameToView(
  vt: ViewportTransform,
  x: number,
  y: number,
): { x: number; y: number } {
  return { x: vt.dx + x * vt.scale, y: vt.dy + y * vt.scale };
}

export function viewToFrame(
  vt: ViewportTransform,
  px: number,
  py: number,
): { x: number; y: number } {
  return { x: (px - vt.dx) / vt.scale, y: (py - vt.dy) / vt.scale };
}

/** Map 1 canvas unit to 1 frame pixel. Onion skins and the current drawing must share this. */
export function enterFrameSpace(
  ctx: CanvasRenderingContext2D,
  vt: ViewportTransform,
  dpr: number,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(vt.dx, vt.dy);
  ctx.scale(vt.scale, vt.scale);
}

export function leaveFrameSpace(ctx: CanvasRenderingContext2D, dpr: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function normToFrame(
  vt: ViewportTransform,
  nx: number,
  ny: number,
): { x: number; y: number } {
  return { x: nx * vt.frameWidth, y: ny * vt.frameHeight };
}

export function normToView(
  vt: ViewportTransform,
  nx: number,
  ny: number,
): { x: number; y: number } {
  return frameToView(vt, nx * vt.frameWidth, ny * vt.frameHeight);
}

export function frameContains(
  vt: ViewportTransform,
  x: number,
  y: number,
): boolean {
  return x >= 0 && y >= 0 && x <= vt.frameWidth && y <= vt.frameHeight;
}

export function zoomAt(
  currentZoom: number,
  factor: number,
  min = 0.1,
  max = 16,
): number {
  return Math.min(max, Math.max(min, currentZoom * factor));
}

/** Pixel-perfect 100% zoom relative to the fit scale. */
export function zoom100Percent(viewWidth: number, viewHeight: number, frameWidth: number, frameHeight: number): number {
  const fit = Math.min(viewWidth / Math.max(1, frameWidth), viewHeight / Math.max(1, frameHeight)) * 0.92;
  if (fit <= 0) return 1;
  return 1 / fit;
}

/** Pan so a 0–1 region sits in the center of the view at the current zoom. */
export function panToNormRegion(opts: {
  viewWidth: number;
  viewHeight: number;
  frameWidth: number;
  frameHeight: number;
  zoom: number;
  region: { x: number; y: number; w: number; h: number };
  fitPad?: number;
}): { panX: number; panY: number } {
  const pad = opts.fitPad ?? 0.92;
  const fw = Math.max(1, opts.frameWidth);
  const fh = Math.max(1, opts.frameHeight);
  const fit = Math.min(opts.viewWidth / fw, opts.viewHeight / fh) * pad;
  const scale = Math.max(0.01, opts.zoom * fit);
  const cx = (opts.region.x + opts.region.w / 2) * fw;
  const cy = (opts.region.y + opts.region.h / 2) * fh;
  return {
    panX: opts.viewWidth / 2 - cx * scale,
    panY: opts.viewHeight / 2 - cy * scale,
  };
}

export function suggestedFocusZoom(region: { w: number; h: number }, max = 3.2): number {
  const size = Math.max(0.08, Math.min(1, Math.max(region.w, region.h)));
  return Math.min(max, Math.max(1.4, 0.55 / size));
}
