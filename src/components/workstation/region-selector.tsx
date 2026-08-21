import type { RegionSelection } from "@/lib/domain/context-engine";
import { regionBoxFromDrag, isUsableRegionBox, type PixelBox } from "@/lib/visual/region-box";

export type { PixelBox };
export { regionBoxFromDrag, isUsableRegionBox };

/** Inspector readout for the current rectangle selection (normalized 0–1). */
export function RegionSelectorStatus({
  region,
  onClear,
}: {
  region: RegionSelection | null;
  onClear: () => void;
}) {
  return (
    <div>
      <p className="text-xs text-muted">Selected region</p>
      {region ? (
        <div className="mt-1 space-y-0.5 font-mono text-[11px] text-faint">
          <p>Frame: F{region.frameNumber}</p>
          <p>X: {region.x.toFixed(3)}</p>
          <p>Y: {region.y.toFixed(3)}</p>
          <p>W: {region.width.toFixed(3)}</p>
          <p>H: {region.height.toFixed(3)}</p>
          <button type="button" className="text-accent" onClick={onClear}>
            Clear Selection
          </button>
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-faint">
          None. Switch to Region click and drag on the canvas.
        </p>
      )}
    </div>
  );
}
