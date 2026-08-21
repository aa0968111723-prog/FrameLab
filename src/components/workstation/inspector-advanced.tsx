import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { padFrame, type FrameType } from "@/lib/domain/types";
import { frameDurationMs } from "@/lib/domain/fps";
import { EXPOSURE_PRESETS, exposureLabel } from "@/lib/domain/exposure";
import { jobStateZh, jobTypeZh } from "@/lib/domain/job-progress";
import type { createTimelineState } from "@/lib/domain/timeline-engine";
import { VisualHistory, type HistoryRow } from "./visual-history";

function scoreKeyZh(k: string) {
  const x = k.toLowerCase();
  if (x.includes("character")) return "角色";
  if (x.includes("face")) return "臉";
  if (x.includes("hand")) return "手";
  if (x.includes("background")) return "背景";
  if (x.includes("flicker") || x.includes("temporal")) return "閃爍";
  if (x.includes("pose")) return "姿態";
  if (x.includes("track")) return "追蹤";
  if (x.includes("motion")) return "運動";
  if (x.includes("contact")) return "接觸";
  if (x.includes("identity")) return "身份";
  if (x.includes("object")) return "物件";
  return k.replaceAll("_", " ");
}

function frameTypeZh(t: string) {
  if (t === "KEY") return "關鍵 ★";
  if (t === "BREAKDOWN") return "分解 ◆";
  if (t === "INBETWEEN") return "中間 ●";
  if (t === "HOLD") return "停留";
  if (t === "GENERATED") return "生成 G";
  if (t === "REPAIRED") return "已修復";
  if (t === "GENERATED_BREAKDOWN") return "生成分解";
  return t;
}

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
  playbackFps,
  onion,
  setOnion,
  cons,
  characters,
  objects,
  tracking,
  jobs,
  revisions,
  poseConstraints,
  motionConstraints,
  busy,
  regionBox,
  setRegionBox,
  regionLive,
  regionKind,
  setRegionKind,
  onType,
  onDuration: _onDuration,
  onExposure,
  onLock,
  onNotes,
  onAnalyze,
  onMotion,
  onTrack,
  onPose,
  onPoseLite,
  onSegment,
  onRepair,
  onRepairRegion,
  onDuplicate,
  onDelete,
  onAddFrame,
  onInsertFrame,
  onClearFrame,
  onHoldFrame,
  onUndo,
  onRedo,
  onPreview,
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
    exposureCount?: number;
  };
  playbackFps: number;
  onion: ReturnType<typeof createTimelineState>["onionSkin"];
  setOnion: (p: Partial<ReturnType<typeof createTimelineState>["onionSkin"]>) => void;
  cons?: { severity: string; scores_json: string; repair_start: number | null; repair_end: number | null };
  characters: { id: string; name: string }[];
  objects: { id: string; name: string }[];
  tracking: { id: string; name: string; x: number; y: number; frame_number: number; status?: string; score?: number }[];
  jobs: { id: string; type: string; state: string; progress: number; error_code: string | null }[];
  revisions: HistoryRow[];
  poseConstraints?: { id: string; frame_number: number; joint: string; x: number; y: number }[];
  motionConstraints?: { id: string; frame_number: number; name: string; x: number; y: number }[];
  busy: boolean;
  regionBox: { x: number; y: number; w: number; h: number };
  setRegionBox: (b: { x: number; y: number; w: number; h: number }) => void;
  regionLive?: boolean;
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
  onPoseLite?: () => void;
  onSegment?: () => void;
  onRepair: () => void;
  onRepairRegion: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAddFrame?: () => void;
  onInsertFrame?: () => void;
  onClearFrame?: () => void;
  onHoldFrame?: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onPreview: (id: string, previewData?: string | null) => void;
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
  const exposure = current.exposureCount ?? 1;
  const holdMs = frameDurationMs(playbackFps, exposure);
  return (
    <div className="space-y-3">
      <p className="font-mono text-lg tabular-nums">{padFrame(current.frameNumber)}</p>
      <Badge tone={typeTone(current.frameType)}>{frameTypeZh(current.frameType)}</Badge>
      <label className="block text-xs text-muted">
        類型
        <select
          className="mt-1 h-9 w-full rounded-[var(--radius-sm)] border border-border bg-subtle px-2 text-sm"
          value={current.frameType}
          onChange={(e) => onType(e.target.value as FrameType)}
        >
          {["KEY", "BREAKDOWN", "INBETWEEN", "HOLD", "GENERATED", "REPAIRED", "GENERATED_BREAKDOWN"].map((t) => (
            <option key={t} value={t}>
              {t === "KEY"
                ? "關鍵 ★"
                : t === "BREAKDOWN"
                  ? "分解 ◆"
                  : t === "INBETWEEN"
                    ? "中間"
                    : t === "HOLD"
                      ? "停留"
                      : t === "GENERATED"
                        ? "生成 G"
                        : t === "REPAIRED"
                          ? "已修復"
                          : "生成分解"}
            </option>
          ))}
        </select>
      </label>
      {(() => {
        const here = (poseConstraints ?? []).filter((c) => c.frame_number === current.frameNumber);
        if (!here.length) {
          return (
            <p className="text-[11px] text-faint">開「骨架」後拖動關節可建立姿態約束，不會改圖。</p>
          );
        }
        return (
          <div className="space-y-1 rounded-[var(--radius-sm)] border border-border p-2">
            <p className="text-[10px] uppercase tracking-wide text-faint">姿態約束</p>
            <ul className="space-y-0.5 text-[11px] text-muted">
              {here.slice(-6).map((c) => (
                <li key={c.id} className="flex justify-between font-mono">
                  <span>{c.joint}</span>
                  <span>
                    {c.x.toFixed(2)} · {c.y.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}
      {(() => {
        const here = (motionConstraints ?? []).filter((c) => c.frame_number === current.frameNumber);
        if (!here.length) {
          return (
            <p className="text-[11px] text-faint">選右手或追蹤點後，拖動路徑控制點可建立運動約束，不會動關鍵影格。</p>
          );
        }
        return (
          <div className="space-y-1 rounded-[var(--radius-sm)] border border-border p-2">
            <p className="text-[10px] uppercase tracking-wide text-faint">路徑約束</p>
            <ul className="space-y-0.5 text-[11px] text-muted">
              {here.slice(-6).map((c) => (
                <li key={c.id} className="flex justify-between font-mono">
                  <span>{c.name}</span>
                  <span>
                    {c.x.toFixed(2)} · {c.y.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}
      <label className="block text-xs text-muted">
        播放時長
        <p className="mt-1 text-sm tabular-nums text-fg">{holdMs} ms</p>
        <p className="mt-0.5 text-[10px] text-faint">
          {playbackFps} fps × {exposureLabel(exposure)}
        </p>
      </label>
      {onExposure && (
        <label className="block text-xs text-muted">
          曝光（一張畫佔幾格播放時間，不是複製圖片）
          <select
            className="mt-1 h-9 w-full rounded-[var(--radius-sm)] border border-border bg-subtle px-2 text-sm"
            value={String(exposure)}
            onChange={(e) => onExposure(Number(e.target.value))}
          >
            {[...EXPOSURE_PRESETS, ...(exposure > 3 ? [exposure] : [])].map((n) => (
              <option key={n} value={n}>
                {exposureLabel(n)}
              </option>
            ))}
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
                <span>{scoreKeyZh(k)}</span>
                <span title={String(v)}>{v.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={onAnalyze}>
          Grok 視覺
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onPose}>
          姿態 RTMPose
        </Button>
        {onPoseLite && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onPoseLite}>
            精簡
          </Button>
        )}
        {onSegment && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={onSegment}>
            遮罩 SAM 2
          </Button>
        )}
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
        <Button size="sm" variant="ghost" disabled={busy || !regionLive || regionBox.w < 8 || regionBox.h < 8} onClick={onRepairRegion}>
          區域修復
        </Button>
        {onAddFrame && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onAddFrame}>
            新增
          </Button>
        )}
        {onInsertFrame && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onInsertFrame}>
            插入
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDuplicate}>
          複製
        </Button>
        {onHoldFrame && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onHoldFrame}>
            停格
          </Button>
        )}
        {onClearFrame && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClearFrame}>
            清空
          </Button>
        )}
        <Button size="sm" variant="danger" disabled={busy} onClick={onDelete}>
          刪除
        </Button>
        <Button size="sm" variant="secondary" onClick={onExport}>
          <Download className="size-3.5" />
          匯出
        </Button>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {([
          ["x", "左"],
          ["y", "上"],
          ["w", "寬"],
          ["h", "高"],
        ] as const).map(([k, label]) => (
          <label key={k} className="block text-[10px] text-faint">
            {label}
            <Input type="number" className="mt-1 h-8" value={regionLive ? regionBox[k] : ""} placeholder="—" disabled={!regionLive} onChange={(e) => setRegionBox({ ...regionBox, [k]: Number(e.target.value) })} />
          </label>
        ))}
      </div>
      {!regionLive && <p className="text-[10px] text-faint">畫布上拖出選區後才會填入座標。不會預設一塊 64×64。</p>}
      <select className="h-8 w-full rounded-[var(--radius-sm)] border border-border bg-subtle px-2 text-xs" value={regionKind} onChange={(e) => setRegionKind(e.target.value)}>
        <option value="custom">自訂</option>
        <option value="hand">手</option>
        <option value="face">臉</option>
        <option value="object">物件</option>
      </select>
      <p className="text-[10px] text-faint">切到遮罩圖層後點角色／物件。SAM 2 切真實遮罩並向前／向後傳播。低信心會警告，不會假裝成功。矩形選區不是 SAM 2。</p>
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
        <Button size="sm" variant="ghost" className="mt-1" onClick={() => onCreateObject("行李箱")}>
          新增行李箱
        </Button>
      </div>
      <p className="text-[11px] text-faint">
        這一格的軌道：{" "}
        {tracking
          .filter((t) => t.frame_number === current.frameNumber)
          .map((t) => `${t.name}${t.score != null ? ` ${"●".repeat(Math.round((t.score ?? 0) * 4))}${"○".repeat(4 - Math.round((t.score ?? 0) * 4))}` : ""}`)
          .join(", ") || "無"}
      </p>
      <VisualHistory rows={revisions} onPreview={onPreview} onRestore={onRestore} onUndo={onUndo} onRedo={onRedo} />
      <ul className="max-h-16 overflow-auto text-[10px] text-faint">
        {jobs.slice(0, 6).map((j) => (
          <li key={j.id}>
            {jobTypeZh(j.type)} · {jobStateZh(j.state)} · {j.progress}%
          </li>
        ))}
      </ul>
      <p className="break-all font-mono text-[10px] text-faint">{current.contentHash}</p>
    </div>
  );
}
