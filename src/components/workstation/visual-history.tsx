import { Button } from "@/components/ui/button";
import { jpegUrl } from "@/lib/visual/jpeg-url";

export type HistoryRow = {
  id: string;
  action: string;
  created_at: string;
  source: string;
  previewData?: string | null;
};

function actionZh(action: string) {
  switch (action) {
    case "accept_generated_frames":
      return "接受中間影格";
    case "reject_generated_frames":
      return "捨棄候選";
    case "execute_repair_plan":
      return "執行修復";
    case "repair_frame":
      return "修復影格";
    case "repair_frame_range":
      return "範圍修復";
    case "replace_frame":
      return "手繪影格";
    case "add_frame":
      return "新增影格";
    case "insert_frame":
      return "插入影格";
    case "duplicate_frame":
      return "複製影格";
    case "delete_frame":
      return "刪除影格";
    case "clear_frame":
      return "清空影格";
    case "hold_frame":
      return "停格";
    case "generate_inbetweens":
      return "產生中間影格";
    case "create_keyframe":
      return "標成關鍵影格";
    case "mark_breakdown":
      return "標成分解影格";
    case "create_breakdown":
      return "分解影格";
    case "edit_pose":
      return "編輯骨架";
    case "edit_motion_path":
      return "編輯路徑";
    default:
      return action.replaceAll("_", " ");
  }
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
              <span className="truncate text-[11px] text-muted">{actionZh(r.action)}</span>
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

