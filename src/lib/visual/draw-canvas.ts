/** Drawing-canvas helpers. Keep stroke math here so the React canvas stays thin. */

export const DRAW_TOOLS = ["brush", "eraser"] as const;
export type DrawTool = (typeof DRAW_TOOLS)[number];

export const DEFAULT_BRUSH_SIZE = 8;
export const MIN_BRUSH_SIZE = 1;
export const MAX_BRUSH_SIZE = 48;
export const MAX_DRAW_UNDOS = 20;

export const BRUSH_COLOR = "#18181b";
export const ERASER_COLOR = "#f4f4f5";

export function clampBrushSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_BRUSH_SIZE;
  return Math.min(MAX_BRUSH_SIZE, Math.max(MIN_BRUSH_SIZE, Math.round(n)));
}

export function isDrawTool(tool: string): tool is DrawTool {
  return tool === "brush" || tool === "eraser";
}

export function strokeWidth(size: number, pressure?: number): number {
  const p = typeof pressure === "number" && pressure > 0 ? Math.min(1, pressure) : 1;
  return Math.max(1, clampBrushSize(size) * (0.35 + 0.65 * p));
}

export function jpegFromDataUrl(dataUrl: string): string {
  const i = dataUrl.indexOf(",");
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

export function shouldPanPointer(opts: {
  tool: string;
  button: number;
  altKey: boolean;
  pointerCount: number;
}): boolean {
  if (opts.pointerCount > 1) return true;
  if (opts.button === 1 || opts.button === 2) return true;
  if (opts.altKey) return true;
  return !isDrawTool(opts.tool);
}
