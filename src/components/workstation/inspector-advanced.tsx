import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { padFrame, type FrameType } from "@/lib/domain/types";
import type { createTimelineState } from "@/lib/domain/timeline-engine";
import { VisualHistory, type HistoryRow } from "./visual-history";

function typeTone(t: string): React.ComponentProps<typeof Badge>["tone"] {
  if (t === "KEY") return "key";
  if (t === "GENERATED") return "gen";
  if (t === "REPAIRED") return "repair";
  if (t === "BREAKDOWN") return "warn";
  if (t === "HOLD") return "muted";
  return "muted";
}

export function AdvancedInspector({
  current,
  onion,
  setOnion,
  cons,
  characters,
  objects,
  tracking,
  jobs,
  revisions,
  busy,
  regionBox,
  setRegionBox,
  regionKind,
  setRegionKind,
  onType,
  onDuration,
  onExposure,
  onLock,
  onNotes,
  onAnalyze,
  onMotion,
  onTrack,
  onPose,
  onRepair,
  onRepairRegion,
  onDuplicate,
  onDelete,
  onUndo,
  onRedo,
  onRestore,
  onExport,
  onCreateCharacter,
  onAssign,
  onCreateObject,
  onAssignObject,
  onDetectKeys,
}: {
  current: {
    id: string;
    frameNumber: number;
    timestampMs: number;
    durationMs: number;
    frameType: string;
    width: number;
    height: number;
    isLocked: boolean;
    notes: string;
    contentHash: string;
  };
  onion: ReturnType<typeof createTimelineState>["onionSkin"];
  setOnion: (p: Partial<ReturnType<typeof createTimelineState>["onionSkin"]>) => void;
  cons?: { severity: string; scores_json: string; repair_start: number | null; repair_end: number | null };
  characters: { id: string; name: string }[];
  objects: { id: string; name: string }[];
  tracking: { id: string; name: string; x: number; y: number; frame_number: number; status?: string; score?: number }[];
  jobs: { id: string; type: string; state: string; progress: number; error_code: string | null }[];
  revisions: HistoryRow[];
  busy: boolean;
  regionBox: { x: number; y: number; w: number; h: number };
  setRegionBox: (b: { x: number; y: number; w: number; h: number }) => void;
  regionKind: string;
  setRegionKind: (k: string) => void;
  onType: (t: FrameType) => void;
  onDuration: (n: number) => void;
  onExposure?: (n: number) => void;
  onLock: (v: boolean) => void;
  onNotes: (n: string) => void;
  onAnalyze: () => void;
  onMotion: () => void;
  onTrack: () => void;
  onPose: () => void;
  onRepair: () => void;
  onRepairRegion: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onRestore: (id: string) => void;
  onExport: () => void;
  onCreateCharacter: (name: string) => void;
  onAssign: (id: string) => void;
  onCreateObject: (name: string) => void;
  onAssignObject: (id: string) => void;
  onDetectKeys: () => void;
}) {
  const [notes, setNotes] = useState(current.notes);
  const [charName, setCharName] = useState("");
  useEffect(() => setNotes(current.notes), [current.id, current.notes]);
  const scores = cons ? (JSON.parse(cons.scores_json) as Record<string, number>) : null;
  return (
    <div className="space-y-3">
      <p className="font-mono text-lg tabular-nums">{padFrame(current.frameNumber)}</p>
      <Badge tone={typeTone(current.frameType)}>{current.frameType}</Badge>
      <label className="block text-xs text-muted">
        類型
        <select
          className="mt-1 h-9 w-full rounded-[var(--radius-sm)] border border-border bg-subtle px-2 text-sm"
          value={current.frameType}
          onChange={(e) => onType(e.target.value as FrameType)}
        >
          {["KEY", "BREAKDOWN", "INBETWEEN", "HOLD", "GENERATED", "REPAIRED", "GENERATED_BREAKDOWN"].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-muted">
        時長（毫秒）
        <Input type="number" className="mt-1" value={current.durationMs} onChange={(e) => onDuration(Number(e.target.value))} />
      </label>
      {onExposure && (
        <label className="block text-xs text-muted">
          曝光（ones / twos / threes）
          <select
            className="mt-1 h-9 w-full rounded-[var(--radius-sm)] border border-border bg-subtle px-2 text-sm"
            defaultValue="1"
            onChange={(e) => onExposure(Number(e.target.value))}
          >
            <option value="1">On ones (1)</option>
            <option value="2">On twos (2)</option>
            <option value="3">On threes (3)</option>
          </select>
        </label>
      )}
      <label className="flex items-center justify-between text-xs text-muted">
        鎖定
        <Switch checked={current.isLocked} onCheckedChange={onLock} />
      </label>
      <label className="block text-xs text-muted">
        備註
        <textarea
          className="mt-1 h-16 w-full rounded-[var(--radius-sm)] border border-border bg-subtle p-2 text-sm"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => onNotes(notes)}
        />
      </label>
      <div>
        <p className="text-xs text-muted">洋蔥皮 前／後</p>
        <Slider className="mt-2" min={0} max={3} step={1} value={[onion.prev]} onValueChange={([v]) => setOnion({ prev: v })} />
        <Slider className="mt-2" min={0} max={3} step={1} value={[onion.next]} onValueChange={([v]) => setOnion({ next: v })} />
        <p className="mt-2 text-[10px] text-faint">透明度 前／後</p>
        <Slider className="mt-2" min={0.05} max={0.8} step={0.05} value={[onion.opacityPrev]} onValueChange={([v]) => setOnion({ opacityPrev: v })} />
        <Slider className="mt-2" min={0.05} max={0.8} step={0.05} value={[onion.opacityNext]} onValueChange={([v]) => setOnion({ opacityNext: v })} />
      </div>
      {scores && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-faint">進階分數</summary>
          <ul className="mt-1 space-y-1 font-mono">
            {Object.entries(scores).map(([k, v]) => (
              <li key={k} className="flex justify-between text-faint">
                <span>{k}</span>
                <span title={String(v)}>{v.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={onAnalyze}>
          Grok
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onPose}>
          姿態精簡
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onMotion}>
          運動
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onTrack}>
          追蹤
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onDetectKeys}>
          關鍵格
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onRepair}>
          混合修復
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onRepairRegion}>
          區域混合
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDuplicate}>
          複製
        </Button>
        <Button size="sm" variant="danger" disabled={busy} onClick={onDelete}>
          刪除
        </Button>
        <Button size="sm" variant="secondary" onClick={onExport}>
          <Download className="size-3.5" />
          匯出
        </Button>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {(["x", "y", "w", "h"] as const).map((k) => (
          <label key={k} className="block text-[10px] text-faint">
            {k}
            <Input type="number" className="mt-1 h-8" value={regionBox[k]} onChange={(e) => setRegionBox({ ...regionBox, [k]: Number(e.target.value) })} />
          </label>
        ))}
      </div>
      <select className="h-8 w-full rounded-[var(--radius-sm)] border border-border bg-subtle px-2 text-xs" value={regionKind} onChange={(e) => setRegionKind(e.target.value)}>
        {["custom", "hand", "face", "object"].map((k) => (
          <option key={k}>{k}</option>
        ))}
      </select>
      <p className="text-[10px] text-faint">SAM2 具名遮罩：MODEL_NOT_AVAILABLE。矩形選區是真的。</p>
      <div>
        <p className="text-xs text-muted">角色</p>
        {characters.map((c) => (
          <button key={c.id} type="button" className="mr-2 text-[11px] text-accent" onClick={() => onAssign(c.id)}>
            {c.name}
          </button>
        ))}
        <form
          className="mt-1 flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (!charName.trim()) return;
            onCreateCharacter(charName.trim());
            setCharName("");
          }}
        >
          <Input value={charName} onChange={(e) => setCharName(e.target.value)} className="h-8" placeholder="名稱" />
          <Button type="submit" size="sm" variant="secondary">
            新增
          </Button>
        </form>
      </div>
      <div>
        <p className="text-xs text-muted">物件</p>
        {objects.map((o) => (
          <button key={o.id} type="button" className="mr-2 text-[11px] text-accent" onClick={() => onAssignObject(o.id)}>
            {o.name}
          </button>
        ))}
        <Button size="sm" variant="ghost" className="mt-1" onClick={() => onCreateObject("Suitcase")}>
          新增行李箱
        </Button>
      </div>
      <p className="text-[11px] text-faint">
        這一格的軌道：{" "}
        {tracking
          .filter((t) => t.frame_number === current.frameNumber)
          .map((t) => `${t.name}${t.score != null ? ` ${"●".repeat(Math.round((t.score ?? 0) * 4))}${"○".repeat(4 - Math.round((t.score ?? 0) * 4))}` : ""}`)
          .join(", ") || "none"}
      </p>
      <VisualHistory rows={revisions} onPreview={onRestore} onRestore={onRestore} onUndo={onUndo} onRedo={onRedo} />
      <ul className="max-h-16 overflow-auto text-[10px] text-faint">
        {jobs.slice(0, 6).map((j) => (
          <li key={j.id}>
            {j.type} · {j.state} · {j.progress}%
          </li>
        ))}
      </ul>
      <p className="break-all font-mono text-[10px] text-faint">{current.contentHash}</p>
    </div>
  );
}
