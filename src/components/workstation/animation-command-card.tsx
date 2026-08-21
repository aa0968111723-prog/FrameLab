import { Button } from "@/components/ui/button";
import type { AnimationCommand } from "@/lib/domain/animation-command";

export function AnimationCommandCard({
  command,
  busy,
  onConfirm,
  onCancel,
}: {
  command: AnimationCommand;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="absolute left-3 top-3 z-30 w-[min(340px,calc(100%-1.5rem))] rounded-[var(--radius-sm)] border border-accent/40 bg-surface/95 p-3 text-[11px] shadow-[var(--shadow-panel)]">
      <p className="text-[10px] uppercase tracking-wide text-faint">確認動畫指令</p>
      <p className="mt-1 text-sm text-fg">{command.title}</p>
      <p className="mt-1 text-muted">{command.summary}</p>
      <ul className="mt-2 space-y-0.5 text-faint">
        {command.details.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-warn">執行前必須確認。現在還不會改時間軸。</p>
      <div className="mt-2 flex gap-1">
        <Button size="sm" variant="secondary" disabled={busy} onClick={onConfirm}>
          確認執行
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}
