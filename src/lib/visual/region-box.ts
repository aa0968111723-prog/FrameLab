export type PixelBox = { x: number; y: number; w: number; h: number };

export function regionBoxFromDrag(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  frameWidth: number,
  frameHeight: number,
): PixelBox {
  const xA = Math.max(0, Math.min(frameWidth, x0));
  const yA = Math.max(0, Math.min(frameHeight, y0));
  const xB = Math.max(0, Math.min(frameWidth, x1));
  const yB = Math.max(0, Math.min(frameHeight, y1));
  return {
    x: Math.min(xA, xB),
    y: Math.min(yA, yB),
    w: Math.max(1, Math.abs(xB - xA)),
    h: Math.max(1, Math.abs(yB - yA)),
  };
}

export function isUsableRegionBox(box: PixelBox, min = 4): boolean {
  return box.w >= min && box.h >= min;
}
