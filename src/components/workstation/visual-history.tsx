import { Button } from "@/components/ui/button";

export type HistoryRow = {
  id: string;
  action: string;
  created_at: string;
  source: string;
  previewData?: string | null;
};

function jpegUrl(b64?: string | null) {
  if (!b64) return "";
  return b64.startsWith("data:") ? b64 : `data:image/jpeg;base64,${b64}`;
}

export function VisualHistory({
  rows,
  onPreview,
  onRestore,
  onUndo,
  onRedo,
}: {
  rows: HistoryRow[];
  onPreview: (id: string, previewData?: string | null) => void;
  onRestore: (id: string) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-faint">視覺歷史</p>
      <div className="mt-1 flex gap-2 text-[11px]">
        <button type="button" className="text-accent" onClick={onUndo}>
          復原
        </button>
        <button type="button" className="text-accent" onClick={onRedo}>
          重做
        </button>
      </div>
      <ul className="mt-2 max-h-36 space-y-1 overflow-auto">
        {rows.length === 0 && <li className="text-[11px] text-faint">原圖 · 尚無修訂</li>}
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-xs)] border border-border px-2 py-1">
            <span className="flex min-w-0 items-center gap-1.5">
              {r.previewData ? (
                <img src={jpegUrl(r.previewData)} alt="" className="h-6 w-6 shrink-0 rounded-[2px] object-cover" />
              ) : null}
              <span className="truncate text-[11px] text-muted">{r.action}</span>
            </span>
            <span className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => onPreview(r.id, r.previewData)}>
                預覽
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => onRestore(r.id)}>
                還原
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

