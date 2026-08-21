/** Onion-skin visibility and alpha. Frame pixels share one viewport with the current drawing. */

export const MAX_ONION_LAYERS = 3;
export const ONION_TINT_PREV = "rgba(120,170,210,0.35)";
export const ONION_TINT_NEXT = "rgba(210,160,120,0.28)";

export function onionShouldShow(opts: { enabled: boolean; compareActive?: boolean }): boolean {
  return Boolean(opts.enabled) && !opts.compareActive;
}

/** Farther neighbors are dimmer. `indexFromFar` 0 is the farthest in that side's list. */
export function onionAlpha(
  side: "prev" | "next",
  indexFromFar: number,
  count: number,
  opacity: number,
): number {
  const n = Math.max(1, count);
  const o = Math.min(1, Math.max(0, opacity));
  if (side === "prev") return o * ((indexFromFar + 1) / n);
  return o * ((n - indexFromFar) / n);
}

export function clampOnionCount(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_ONION_LAYERS, Math.max(0, Math.round(n)));
}

export function clampOnionOpacity(n: number): number {
  if (!Number.isFinite(n)) return 0.35;
  return Math.min(0.8, Math.max(0.05, n));
}
