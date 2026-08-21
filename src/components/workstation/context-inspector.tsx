import type { SerializedContext } from "@/lib/domain/context-engine";

/** Right-rail snapshot of what the assistant will read. */
export function ContextInspector({ snapshot }: { snapshot: SerializedContext }) {
  return (
    <div>
      <p className="text-xs text-muted">上下文檢視</p>
      <ul className="mt-1 space-y-0.5 font-mono text-[10px] text-faint">
        <li>影格 {snapshot.current_frame ?? "—"}</li>
        <li>
          範圍{" "}
          {snapshot.selected_range
            ? `${snapshot.selected_range[0]}–${snapshot.selected_range[1]}`
            : "—"}
        </li>
        <li>
          選區{" "}
          {snapshot.selected_region
            ? `F${snapshot.selected_region.frameNumber} x=${snapshot.selected_region.x.toFixed(3)} y=${snapshot.selected_region.y.toFixed(3)} w=${snapshot.selected_region.width.toFixed(3)} h=${snapshot.selected_region.height.toFixed(3)}`
            : "—"}
        </li>
        <li>角色 {snapshot.selected_character ?? "—"}</li>
        <li>物件 {snapshot.selected_object ?? "—"}</li>
        <li>
          洋蔥皮 {snapshot.onion_skin.enabled ? "開" : "關"}{" "}
          {snapshot.onion_skin.previousFrames}/{snapshot.onion_skin.nextFrames}
        </li>
        <li>焦點 {focusZh(snapshot.focus)}</li>
        <li>對話 {snapshot.conversation_id ?? "—"}</li>
        <li>v{snapshot.context_version}</li>
      </ul>
    </div>
  );
}

function focusZh(focus: string) {
  if (focus === "current_frame") return "目前影格";
  if (focus === "selected_frame_range" || focus === "range") return "範圍";
  if (focus === "selected_region" || focus === "region") return "選區";
  if (focus === "character") return "角色";
  if (focus === "current_timeline") return "時間軸";
  if (focus === "current_project") return "專案";
  return focus;
}

