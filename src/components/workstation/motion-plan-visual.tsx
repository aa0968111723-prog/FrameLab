import type { MotionPlanView } from "./inbetween-panel";

export function MotionPlanVisual({ plan }: { plan: MotionPlanView | null }) {
  if (!plan) return null;
  const chars = plan.characters ?? [];
  const objs = plan.objects ?? [];
  return (
    <div className="rounded-[var(--radius-sm)] border border-border bg-subtle p-2 text-[11px]">
      <p className="text-[10px] uppercase tracking-wide text-faint">動作計畫</p>
      <ul className="mt-2 space-y-1 text-muted">
        {chars.map((c) => (
          <li key={c.character_id} className="flex justify-between gap-2">
            <span className="text-fg">{String(c.pose_transition?.name ?? c.character_id)}</span>
            <span>
              {c.motion.direction} · {c.motion.distance_normalized.toFixed(2)}
            </span>
          </li>
        ))}
        {objs.map((o) => (
          <li key={o.object_id} className="flex justify-between gap-2">
            <span className="text-fg">{o.constraint}</span>
            <span>{o.constraint}</span>
          </li>
        ))}
        <li className="flex justify-between">
          <span>相機</span>
          <span>{plan.camera?.movement ?? "未知"}</span>
        </li>
        <li className="flex justify-between">
          <span>曲線</span>
          <span>{plan.curve}</span>
        </li>
      </ul>
    </div>
  );
}

export function ConstraintChips({
  constraints,
}: {
  constraints: {
    preserveCharacter: boolean;
    preserveFace: boolean;
    preserveBackground: boolean;
    maintainContact: boolean;
    keepCameraStatic: boolean;
    preserveClothing?: boolean;
    preserveHair?: boolean;
    preserveBody?: boolean;
  };
}) {
  const chips: { label: string; note?: string }[] = [];
  if (constraints.preserveCharacter) chips.push({ label: "鎖定角色" });
  if (constraints.preserveFace) chips.push({ label: "鎖定臉", note: "僅評估" });
  if (constraints.preserveHair) chips.push({ label: "鎖定頭髮", note: "僅評估" });
  if (constraints.preserveClothing) chips.push({ label: "鎖定服裝", note: "僅評估" });
  if (constraints.preserveBody) chips.push({ label: "鎖定身體", note: "僅評估" });
  if (constraints.preserveBackground) chips.push({ label: "鎖定背景", note: "僅評估" });
  if (constraints.maintainContact) chips.push({ label: "手 ↔ 物件", note: "僅評估" });
  if (constraints.keepCameraStatic) chips.push({ label: "相機鎖定" });
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <span key={c.label} className="rounded-full bg-raised px-2 py-0.5 text-[10px] text-muted">
          {c.label}
          {c.note ? ` · ${c.note}` : ""}
        </span>
      ))}
    </div>
  );
}
