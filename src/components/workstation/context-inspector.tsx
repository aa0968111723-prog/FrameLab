import type { SerializedContext } from "@/lib/domain/context-engine";

/** Right-rail snapshot of what the assistant will read. */
export function ContextInspector({ snapshot }: { snapshot: SerializedContext }) {
  return (
    <div>
      <p className="text-xs text-muted">Context inspector</p>
      <ul className="mt-1 space-y-0.5 font-mono text-[10px] text-faint">
        <li>frame {snapshot.current_frame ?? "—"}</li>
        <li>
          range{" "}
          {snapshot.selected_range
            ? `${snapshot.selected_range[0]}–${snapshot.selected_range[1]}`
            : "—"}
        </li>
        <li>
          region{" "}
          {snapshot.selected_region
            ? `F${snapshot.selected_region.frameNumber} x=${snapshot.selected_region.x.toFixed(3)} y=${snapshot.selected_region.y.toFixed(3)} w=${snapshot.selected_region.width.toFixed(3)} h=${snapshot.selected_region.height.toFixed(3)}`
            : "—"}
        </li>
        <li>character {snapshot.selected_character ?? "—"}</li>
        <li>object {snapshot.selected_object ?? "—"}</li>
        <li>
          onion {snapshot.onion_skin.enabled ? "on" : "off"}{" "}
          {snapshot.onion_skin.previousFrames}/{snapshot.onion_skin.nextFrames}
        </li>
        <li>focus {snapshot.focus}</li>
        <li>conversation {snapshot.conversation_id ?? "—"}</li>
        <li>v{snapshot.context_version}</li>
      </ul>
    </div>
  );
}
