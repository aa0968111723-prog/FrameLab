import { Button } from "@/components/ui/button";

export type HistoryRow = {
  id: string;
  action: string;
  created_at: string;
  source: string;
};

export function VisualHistory({
  rows,
  onPreview,
  onRestore,
  onUndo,
  onRedo,
}: {
  rows: HistoryRow[];
  onPreview: (id: string) => void;
  onRestore: (id: string) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-faint">Visual history</p>
      <div className="mt-1 flex gap-2 text-[11px]">
        <button type="button" className="text-accent" onClick={onUndo}>
          Undo
        </button>
        <button type="button" className="text-accent" onClick={onRedo}>
          Redo
        </button>
      </div>
      <ul className="mt-2 max-h-36 space-y-1 overflow-auto">
        {rows.length === 0 && <li className="text-[11px] text-faint">Original · no revisions yet</li>}
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-xs)] border border-border px-2 py-1">
            <span className="truncate text-[11px] text-muted">{r.action}</span>
            <span className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => onPreview(r.id)}>
                Preview
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => onRestore(r.id)}>
                Restore
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
