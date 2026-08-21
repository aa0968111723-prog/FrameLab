import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RegionRepairPipeline } from "@/lib/domain/region-repair";

export function RegionRepairPanel({
  pipeline,
  busy,
  onPreview,
  onAccept,
  onReject,
  onClose,
}: {
  pipeline: RegionRepairPipeline;
  busy?: boolean;
  onPreview?: () => void;
  onAccept?: () => void;
  onReject?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute left-3 top-3 z-20 w-[min(360px,calc(100%-1.5rem))] rounded-[var(--radius-sm)] border border-border bg-surface/95 p-2.5 text-[11px] shadow-[var(--shadow-panel)]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide text-faint">區域修復</p>
        <button type="button" className="text-faint hover:text-fg" onClick={onClose}>
          關閉
        </button>
      </div>
      <ol className="mb-2 flex flex-wrap gap-1">
        {pipeline.stages.map((s, i) => (
          <li key={s.id} className="flex items-center gap-1">
            {i > 0 ? <span className="text-faint">→</span> : null}
            <span
              className={cn(
                "rounded-[var(--radius-xs)] px-1.5 py-0.5",
                s.done
                  ? "bg-raised text-fg"
                  : pipeline.current === s.id
                    ? "border border-accent text-fg"
                    : "text-faint",
              )}
            >
              {s.label}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-[10px] text-muted">
        遮罩：{pipeline.mask?.source === "sam2" ? "SAM 2" : pipeline.mask ? "矩形選區（不是 SAM 2）" : "尚未選取"}
      </p>
      <p className="mt-0.5 font-mono text-[10px] text-faint">
        {pipeline.temporal.before.map((n) => `F${n}`).join(" ")}
        {pipeline.temporal.before.length ? " " : ""}
        <span className="text-fg">[F{pipeline.temporal.current}]</span>
        {pipeline.temporal.after.length ? " " : ""}
        {pipeline.temporal.after.map((n) => `F${n}`).join(" ")}
      </p>
      {pipeline.available && pipeline.ai ? (
        <p className="mt-2 text-muted">{pipeline.note}</p>
      ) : pipeline.candidateId ? (
        <p className="mt-2 text-muted">{pipeline.note}</p>
      ) : (
        <p className="mt-2 text-[12px] text-fg">生成修復尚未設定。不會用矩形框混合冒充 AI。</p>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        {onPreview && !pipeline.candidateId ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onPreview}>
            快速預覽
          </Button>
        ) : null}
        {pipeline.candidateId && onAccept ? (
          <Button size="sm" variant="secondary" disabled={busy} onClick={onAccept}>
            接受候選
          </Button>
        ) : null}
        {pipeline.candidateId && onReject ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onReject}>
            拒絕
          </Button>
        ) : null}
      </div>
    </div>
  );
}
