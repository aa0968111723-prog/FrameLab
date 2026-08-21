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
      <p className="text-xs text-muted">選取區域</p>
      {region ? (
        <div className="mt-1 space-y-0.5 font-mono text-[11px] text-faint">
          <p>影格: F{region.frameNumber}</p>
          <p>X: {region.x.toFixed(3)}</p>
          <p>Y: {region.y.toFixed(3)}</p>
          <p>W: {region.width.toFixed(3)}</p>
          <p>H: {region.height.toFixed(3)}</p>
          <button type="button" className="text-accent" onClick={onClear}>
            清除選取
          </button>
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-faint">
          無。切到選區工具後在畫布上拖曳。
        </p>
      )}
    </div>
  );
}
