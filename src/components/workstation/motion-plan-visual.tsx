import type { MotionPlanView } from "./inbetween-panel";

export function MotionPlanVisual({ plan }: { plan: MotionPlanView | null }) {
  if (!plan) return null;
  const chars = plan.characters ?? [];
  const objs = plan.objects ?? [];
  return (
    <div className="rounded-[var(--radius-sm)] border border-border bg-subtle p-2 text-[11px]">
      <p className="text-[10px] uppercase tracking-wide text-faint">Motion plan</p>
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
          <span>Camera</span>
          <span>{plan.camera?.movement ?? "unknown"}</span>
        </li>
        <li className="flex justify-between">
          <span>Curve</span>
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
  if (constraints.preserveCharacter) chips.push({ label: "Character lock" });
  if (constraints.preserveFace) chips.push({ label: "Face lock", note: "eval only" });
  if (constraints.preserveHair) chips.push({ label: "Hair lock", note: "eval only" });
  if (constraints.preserveClothing) chips.push({ label: "Clothing lock", note: "eval only" });
  if (constraints.preserveBody) chips.push({ label: "Body lock", note: "eval only" });
  if (constraints.preserveBackground) chips.push({ label: "Background lock", note: "eval only" });
  if (constraints.maintainContact) chips.push({ label: "Hand ↔ object", note: "eval only" });
  if (constraints.keepCameraStatic) chips.push({ label: "Camera locked" });
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
