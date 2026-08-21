import type { MotionPlanView } from "./inbetween-panel";
import { curveCaption } from "@/lib/visual/motion-curve-visual";

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
              {directionZh(c.motion.direction)} · {c.motion.distance_normalized.toFixed(2)}
            </span>
          </li>
        ))}
        {objs.map((o) => (
          <li key={o.object_id} className="flex justify-between gap-2">
            <span className="text-fg">物件</span>
            <span>{constraintZh(o.constraint)}</span>
          </li>
        ))}
        <li className="flex justify-between">
          <span>相機</span>
          <span>{cameraMoveZh(plan.camera?.movement)}</span>
        </li>
        <li className="flex justify-between">
          <span>曲線</span>
          <span>{curveCaption(plan.curve)}</span>
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

function cameraMoveZh(move?: string) {
  if (!move) return "未知";
  const m = move.toLowerCase();
  if (m.includes("static") || m.includes("still")) return "靜止";
  if (m.includes("pan")) return "平移";
  if (m.includes("tilt")) return "俯仰";
  if (m.includes("zoom")) return "縮放";
  if (m.includes("track")) return "跟隨";
  return "未知";
}

function constraintZh(kind: string) {
  const k = kind.toLowerCase();
  if (k.includes("character")) return "角色";
  if (k.includes("face")) return "臉";
  if (k.includes("background")) return "背景";
  if (k.includes("contact")) return "接觸";
  if (k.includes("camera")) return "相機";
  if (k.includes("object")) return "物件";
  if (k.includes("hold")) return "跟隨";
  return "約束";
}

function directionZh(d: string) {
  const x = d.toLowerCase();
  if (x.includes("up")) return "上";
  if (x.includes("down")) return "下";
  if (x.includes("left")) return "左";
  if (x.includes("right")) return "右";
  if (x.includes("in")) return "靠近";
  if (x.includes("out")) return "遠離";
  if (x.includes("still") || x.includes("none")) return "幾乎不動";
  return "方向";
}

