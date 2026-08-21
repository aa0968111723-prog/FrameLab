import { Button } from "@/components/ui/button";

export function RegionActions({
  visible,
  frame,
  onAnalyze,
  onTrack,
  onRepair,
  onPropagate,
  onClear,
}: {
  visible: boolean;
  frame: number;
  onAnalyze: () => void;
  onTrack: () => void;
  onRepair: () => void;
  onPropagate: () => void;
  onClear: () => void;
}) {
  if (!visible) return null;
  return (
    <div className="pointer-events-auto absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-[var(--radius-sm)] border border-border bg-surface/95 px-2 py-1.5 shadow-[var(--shadow-panel)]">
      <span className="mr-1 font-mono text-[10px] text-faint">F{frame} 選區</span>
      <Button size="sm" variant="secondary" onClick={onAnalyze}>
        問 AI
      </Button>
      <Button size="sm" variant="ghost" onClick={onTrack}>
        追蹤
      </Button>
      <Button size="sm" variant="ghost" onClick={onPropagate}>
        傳播 ±5
      </Button>
      <Button size="sm" variant="secondary" onClick={onRepair}>
        在此修復
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear}>
        清除
      </Button>
    </div>
  );
}
