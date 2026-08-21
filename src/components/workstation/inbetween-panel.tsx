/** Inspector Inbetween panel — plan → confirm → candidate → accept. Never auto-writes. */

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { curveCaption } from "@/lib/visual/motion-curve-visual";
import { jpegUrl } from "@/lib/visual/jpeg-url";
import { categoryLabel } from "@/lib/domain/visual-annotation";
import { BREAKDOWN_SET_TYPES } from "@/lib/domain/breakdown";

export type BreakdownCreateInput = {
  mode: "blank" | "copy" | "mark";
  copyFrom?: "start" | "end";
  frameNumber?: number;
  frameType?: string;
};

export type InbetweenConstraints = {
  preserveCharacter: boolean;
  preserveFace: boolean;
  preserveBackground: boolean;
  maintainContact: boolean;
  keepCameraStatic: boolean;
};

export type InbetweenAnalysis = {
  complexity: string;
  score: number;
  reasons: string[];
  suggest_breakdown: boolean;
  suggested_breakdown: number | null;
  suggested_breakdowns?: number[];
  suggestions?: { frame_number: number; reason: string }[];
  suggestion_reason?: string;
  strategy: { kind: string; provider: string; reason: string };
};

export type InbetweenConfirmation = {
  title: string;
  start: number;
  end: number;
  frames: number;
  curve: string;
  constraints: string[];
  provider: string;
  warnings?: { constraint: string; message: string }[];
  blocked?: boolean;
  reason?: string;
  suggested_breakdown?: number | null;
  suggested_breakdowns?: number[];
};

export type MotionPlanView = {
  version: number;
  curve: string;
  camera?: { movement: string };
  characters?: { character_id: string; motion: { direction: string; distance_normalized: number }; pose_transition: Record<string, unknown> }[];
  objects?: { object_id: string; constraint: string }[];
  breakdowns?: number[];
  constraints?: { kind: string }[];
  spacing?: number[];
  timing?: { frames: number; fps: number };
};

export type InbetweenCandidateView = {
  candidateId: string;
  previousCandidateId?: string;
  previousFrames?: { frameNumber: number; motion_progress: number; thumbnailData: string; imageData?: string }[];
  provider: string;
  count: number;
  quality: string;
  evaluation?: {
    scores?: Record<string, number>;
    ranges?: { start: number; end: number }[];
    problems?: { frame_number: number; category: string; severity: string; reason: string; score?: number }[];
  };
  warnings?: { constraint: string; message: string }[];
  frames: { frameNumber: number; motion_progress: number; thumbnailData: string; imageData?: string }[];
};

export type InbetweenPanelState = {
  start: number | null;
  end: number | null;
  count: number;
  curve: string;
  quality: "preview" | "production";
  constraints: InbetweenConstraints;
  analysis: InbetweenAnalysis | null;
  confirmation: InbetweenConfirmation | null;
  candidate: InbetweenCandidateView | null;
  plan: MotionPlanView | null;
  busy: boolean;
};

function typeZh(t: string) {
  if (t === "KEY") return "關鍵 ★";
  if (t === "BREAKDOWN") return "分解 ◆";
  if (t === "INBETWEEN") return "中間";
  if (t === "HOLD") return "停留";
  return t;
}

export function InbetweenPanel({
  currentFrame,
  selectedRange,
  state,
  onCount,
  onCurve,
  onQuality,
  onConstraint,
  onSetStart,
  onSetEnd,
  onUseRange,
  onAnalyze,
  onPlan,
  onConfirmGenerate,
  onForceGenerate,
  onCancelConfirm,
  onAccept,
  onReject,
  onRegenerate,
  onCreateBreakdown,
  onSuggestBreakdowns,
  onSetFrameType,
  onViewCandidate,
  onSeekCandidate,
  onCompareCandidates,
  onExportSequence,
  onRenderPreview,
}: {
  currentFrame: number;
  selectedRange: [number, number] | null;
  state: InbetweenPanelState;
  onCount: (n: number) => void;
  onCurve: (c: string) => void;
  onQuality: (q: "preview" | "production") => void;
  onConstraint: (k: keyof InbetweenConstraints, v: boolean) => void;
  onSetStart: () => void;
  onSetEnd: () => void;
  onUseRange: () => void;
  onAnalyze: () => void;
  onPlan: () => void;
  onConfirmGenerate: () => void;
  onForceGenerate: () => void;
  onCancelConfirm: () => void;
  onAccept: () => void;
  onReject: () => void;
  onRegenerate: () => void;
  onCreateBreakdown: (input: BreakdownCreateInput) => void;
  onSuggestBreakdowns: () => void;
  onSetFrameType: (n: number, t: string) => void;
  onViewCandidate: () => void;
  onSeekCandidate: (n: number) => void;
  onCompareCandidates: () => void;
  onExportSequence: () => void;
  onRenderPreview: () => void;
}) {
  const gap =
    state.start != null && state.end != null ? Math.max(0, state.end - state.start) : null;
  const generated = gap != null ? Math.max(0, gap - 1) : state.count;
  const suggested =
    state.analysis?.suggestions ??
    (state.analysis?.suggested_breakdowns ?? state.plan?.breakdowns ?? []).map((n) => ({
      frame_number: n,
      reason: "建議分解",
    }));
  const defaultTarget =
    suggested[0]?.frame_number ??
    (state.start != null && state.end != null && state.end - state.start > 1
      ? Math.round((state.start + state.end) / 2)
      : currentFrame);
  const [target, setTarget] = useState(defaultTarget);
  const [frameType, setFrameType] = useState<(typeof BREAKDOWN_SET_TYPES)[number]>("BREAKDOWN");
  useEffect(() => {
    setTarget(defaultTarget);
  }, [defaultTarget, state.start, state.end]);
  const pairReady = state.start != null && state.end != null;
  const create = (mode: BreakdownCreateInput["mode"], copyFrom?: "start" | "end") => {
    if (!pairReady) return;
    onCreateBreakdown({
      mode,
      copyFrom,
      frameNumber: Number.isFinite(target) ? target : undefined,
      frameType,
    });
  };

  return (
    <div className="space-y-3 rounded-[var(--radius-sm)] border border-border bg-subtle p-3">
      <p className="text-xs uppercase tracking-wide text-faint">中間影格</p>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-faint">起點</p>
          <p className="font-mono text-sm">
            {state.start != null ? `F${state.start} ★` : "—"}
          </p>
          <Button size="sm" variant="ghost" onClick={onSetStart} disabled={state.busy}>
            設為 F{currentFrame}
          </Button>
        </div>
        <div>
          <p className="text-faint">終點</p>
          <p className="font-mono text-sm">
            {state.end != null ? `F${state.end} ★` : "—"}
          </p>
          <Button size="sm" variant="ghost" onClick={onSetEnd} disabled={state.busy}>
            設為 F{currentFrame}
          </Button>
        </div>
      </div>
      {selectedRange && (
        <Button size="sm" variant="ghost" onClick={onUseRange} disabled={state.busy}>
          使用範圍 F{selectedRange[0]}–F{selectedRange[1]}
        </Button>
      )}
      {gap != null && (
        <p className="text-[11px] text-muted">
          間隔：{gap} 格 · 將產生：{generated}
        </p>
      )}
      <div className="space-y-2 rounded-[var(--radius-sm)] border border-warn/40 bg-raised p-2">
        <p className="text-xs uppercase tracking-wide text-faint">分解影格</p>
        <p className="text-[11px] text-muted">
          在關鍵影格 A／B 中間加分解。空白或複製後再畫。不是生成式 Breakdown。
        </p>
        <label className="block text-xs text-muted">
          目標格
          <Input
            type="number"
            className="mt-1"
            value={Number.isFinite(target) ? target : ""}
            onChange={(e) => setTarget(Number(e.target.value))}
          />
        </label>
        <div className="flex flex-wrap gap-1">
          {suggested.map((s) => (
            <button
              key={`${s.frame_number}-${s.reason}`}
              type="button"
              disabled={state.busy}
              onClick={() => setTarget(s.frame_number)}
              className="rounded-[var(--radius-xs)] border border-warn/40 px-1.5 py-0.5 font-mono text-[10px] text-warn hover:bg-warn/10"
              title={s.reason}
            >
              F{s.frame_number} {s.reason}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="secondary" disabled={state.busy || !pairReady} onClick={onSuggestBreakdowns}>
            建議位置
          </Button>
          <Button size="sm" variant="secondary" disabled={state.busy || !pairReady} onClick={() => create("blank")}>
            空白 Breakdown
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={state.busy || !pairReady}
            onClick={() => create("copy", "start")}
          >
            複製 A 修改
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={state.busy || !pairReady}
            onClick={() => create("copy", "end")}
          >
            複製 B 修改
          </Button>
        </div>
        <label className="block text-xs text-muted">
          影格類型
          <select
            className="mt-1 h-9 w-full rounded-[var(--radius-sm)] border border-border bg-subtle px-2 text-sm text-fg"
            value={frameType}
            onChange={(e) => setFrameType(e.target.value as (typeof BREAKDOWN_SET_TYPES)[number])}
          >
            {BREAKDOWN_SET_TYPES.map((t) => (
              <option key={t} value={t}>
                {typeZh(t)}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          variant="ghost"
          disabled={state.busy || !Number.isFinite(target)}
          onClick={() => onSetFrameType(target, frameType)}
        >
          套用類型到 F{Number.isFinite(target) ? target : "—"}
        </Button>
      </div>
      <label className="block text-xs text-muted">
        影格數
        <Input
          type="number"
          className="mt-1"
          min={1}
          max={40}
          value={state.count}
          onChange={(e) => onCount(Number(e.target.value))}
        />
      </label>
      <fieldset className="space-y-1">
        <legend className="text-xs text-muted">運動曲線</legend>
        {(["linear", "ease_in", "ease_out", "ease_in_out", "hold"] as const).map((c) => (
          <label key={c} className="flex items-center gap-2 text-[11px] text-fg">
            <input
              type="radio"
              name="motion-curve"
              checked={state.curve === c}
              onChange={() => onCurve(c)}
            />
            {c === "linear"
              ? "線性"
              : c === "ease_in"
                ? "緩入"
                : c === "ease_out"
                  ? "緩出"
                  : c === "ease_in_out"
                    ? "緩入緩出"
                    : "停留"}
          </label>
        ))}
      </fieldset>
      <label className="block text-xs text-muted">
        品質
        <select
          className="mt-1 h-9 w-full rounded-[var(--radius-sm)] border border-border bg-subtle px-2 text-sm text-fg"
          value={state.quality}
          onChange={(e) => onQuality(e.target.value === "production" ? "production" : "preview")}
        >
          <option value="preview">快速預覽（非 AI）</option>
          <option value="production">RIFE 中割</option>
        </select>
      </label>
      <p className="text-[11px] text-faint">
        成品用 RIFE 中割。快速預覽是線性混合，不是 AI 中割。
      </p>
      <fieldset className="space-y-1">
        <legend className="text-xs text-muted">約束</legend>
        {(
          [
            ["preserveCharacter", "角色"],
            ["preserveFace", "臉"],
            ["preserveBackground", "背景"],
            ["maintainContact", "手 ↔ 行李箱"],
            ["keepCameraStatic", "相機靜止"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-[11px]">
            <input
              type="checkbox"
              checked={state.constraints[k]}
              onChange={(e) => onConstraint(k, e.target.checked)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      {state.plan && (
        <div className="space-y-1 rounded-[var(--radius-sm)] border border-border p-2 text-[11px]">
          <p className="text-xs uppercase tracking-wide text-faint">動作計畫 v{state.plan.version}</p>
          <p className="text-muted">
            曲線 {curveCaption(state.plan.curve)}
            {state.plan.timing ? ` · ${state.plan.timing.frames} 格 @ ${state.plan.timing.fps} fps` : ""}
          </p>
          <p className="text-muted">相機：{cameraMoveZh(state.plan.camera?.movement)}</p>
          {(state.plan.characters ?? []).length > 0 ? (
            <ul className="text-fg">
              {(state.plan.characters ?? []).map((c) => (
                <li key={c.character_id}>
                  角色 {String(c.pose_transition?.name ?? c.character_id.slice(0, 8))} · {directionZh(c.motion.direction)} · 距離{" "}
                  {c.motion.distance_normalized.toFixed(2)}
                  {typeof c.pose_transition.pose_displacement === "number"
                    ? ` · 姿態 Δ ${Number(c.pose_transition.pose_displacement).toFixed(2)}`
                    : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-faint">起點關鍵影格尚未指定角色。</p>
          )}
          {(state.plan.objects ?? []).length > 0 && (
            <ul>
              {(state.plan.objects ?? []).map((o) => (
                <li key={o.object_id}>物件 · {constraintZh(o.constraint)}</li>
              ))}
            </ul>
          )}
          {(state.plan.constraints ?? []).length > 0 && (
            <p className="text-muted">
              約束：{(state.plan.constraints ?? []).map((c) => constraintZh(c.kind)).join(" · ")}
            </p>
          )}
          {(state.plan.breakdowns ?? []).length > 0 && (
            <p className="text-muted">分解影格：{(state.plan.breakdowns ?? []).map((n) => `F${n}`).join(", ")}</p>
          )}
          {(state.plan.spacing ?? []).length > 0 && (
            <p className="font-mono text-faint">
              間距 {state.plan.spacing!.slice(0, 9).map((s) => s.toFixed(2)).join(" ")}
            </p>
          )}
        </div>
      )}
      {state.analysis && (
        <div className="space-y-1 text-[11px] text-muted">
          <p>
            複雜度 {complexityZh(state.analysis.complexity)}（{Math.round(state.analysis.score * 100)}%）
          </p>
          <p>{state.analysis.strategy.reason}</p>
          {state.analysis.suggest_breakdown && (state.analysis.suggested_breakdowns?.length || state.analysis.suggested_breakdown != null) && (
            <div className="flex flex-wrap gap-1">
              {(state.analysis.suggested_breakdowns?.length
                ? state.analysis.suggested_breakdowns
                : [state.analysis.suggested_breakdown!]
              ).map((n) => (
                <Button
                  key={n}
                  size="sm"
                  variant="secondary"
                  disabled={state.busy}
                  onClick={() => onCreateBreakdown({ mode: "blank", frameNumber: n, frameType: "BREAKDOWN" })}
                >
                  空白 Breakdown F{n}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="secondary" disabled={state.busy} onClick={onAnalyze}>
          分析轉場
        </Button>
        <Button size="sm" variant="secondary" disabled={state.busy} onClick={onPlan}>
          <Sparkles className="size-3.5" />
          產生計畫
        </Button>
      </div>

      {state.confirmation && (
        <div className="space-y-2 rounded-[var(--radius-sm)] border border-accent/40 bg-raised p-2">
          <p className="text-xs font-medium">{state.confirmation.title}</p>
          <p className="font-mono text-[11px] text-muted">
            F{state.confirmation.start} → F{state.confirmation.end}
          </p>
          <ul className="text-[11px] text-muted">
            <li>影格數：{state.confirmation.frames}</li>
            <li>運動：{curveCaption(state.confirmation.curve)}</li>
            <li>供應商：{providerZh(state.confirmation.provider)}</li>
          </ul>
          {state.confirmation.constraints.length > 0 && (
            <ul className="text-[11px] text-fg">
              {state.confirmation.constraints.map((c) => (
                <li key={c}>✓ {constraintZh(c)}</li>
              ))}
            </ul>
          )}
          {(state.confirmation.warnings ?? []).map((w) => (
            <p key={w.constraint} className="text-[11px] text-warn">
              {w.message}
            </p>
          ))}
          {state.confirmation.blocked ? (
            <div className="space-y-1">
              <p className="text-[11px] text-warn">{state.confirmation.reason}</p>
              {state.confirmation.suggested_breakdown != null && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={state.busy}
                  onClick={() =>
                    onCreateBreakdown({
                      mode: "blank",
                      frameNumber: state.confirmation!.suggested_breakdown!,
                      frameType: "BREAKDOWN",
                    })
                  }
                >
                  空白 Breakdown F{state.confirmation.suggested_breakdown}
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={state.busy} onClick={onForceGenerate}>
                仍直接生成
              </Button>
            </div>
          ) : (
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" disabled={state.busy} onClick={onConfirmGenerate}>
                產生
              </Button>
              <Button size="sm" variant="ghost" disabled={state.busy} onClick={onCancelConfirm}>
                取消
              </Button>
            </div>
          )}
        </div>
      )}

      {state.candidate && (
        <div className="space-y-2 rounded-[var(--radius-sm)] border border-gen/40 p-2">
          <p className="text-xs font-medium">
            {state.candidate.count} 格已產生 · {providerZh(state.candidate.provider)} · {state.candidate.quality === "production" ? "成品" : "預覽"}
          </p>
          <p className="text-[11px] text-faint">僅為候選版本 — 尚未寫入時間軸。</p>
          {state.candidate.frames.length > 0 && (
            <div className="flex gap-1 overflow-x-auto scrollbar-thin">
              {state.candidate.frames.map((f) => (
                <button key={f.frameNumber} type="button" onClick={() => onSeekCandidate(f.frameNumber)} className="w-10 shrink-0">
                  <span className="block h-10 w-10 overflow-hidden rounded-[var(--radius-xs)] border border-gen/40">
                    {f.thumbnailData ? (
                      <img
                        src={jpegUrl(f.thumbnailData)}
                        alt={`F${f.frameNumber}`}
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </span>
                  <span className="font-mono text-[9px] text-faint">F{f.frameNumber}</span>
                </button>
              ))}
            </div>
          )}
          {state.candidate.evaluation?.scores && (
            <ul className="space-y-0.5 text-[11px]">
              {Object.entries(state.candidate.evaluation.scores).map(([k, v]) => (
                <li key={k} className="flex justify-between">
                  <span className="text-faint">{scoreKeyZh(k)}</span>
                  <span className={v < 0.8 ? "text-warn" : "text-fg"}>{Math.round(v * 100)}%{v < 0.8 ? " ⚠" : ""}</span>
                </li>
              ))}
            </ul>
          )}
          {(state.candidate.evaluation?.problems ?? []).length > 0 && (
            <div className="text-[11px] text-warn">
              <p>問題：</p>
              <ul>
                {(state.candidate.evaluation?.problems ?? []).slice(0, 6).map((p) => (
                  <li key={`${p.frame_number}-${p.category}`}>
                    F{p.frame_number} {categoryLabel(p.category)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(state.candidate.warnings ?? []).map((w) => (
            <p key={w.constraint} className="text-[11px] text-warn">
              {w.message}
            </p>
          ))}
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="secondary" disabled={state.busy} onClick={onViewCandidate}>
              查看
            </Button>
            {state.candidate.previousCandidateId && (state.candidate.previousFrames?.length ?? 0) > 0 && (
              <Button size="sm" variant="secondary" disabled={state.busy} onClick={onCompareCandidates}>
                比較 A／B
              </Button>
            )}
            {(state.candidate.evaluation?.problems ?? []).length > 0 && (
              <Button size="sm" variant="secondary" disabled={state.busy} onClick={onRegenerate}>
                只重產問題格
              </Button>
            )}
            <Button size="sm" variant="secondary" disabled={state.busy} onClick={onAccept}>
              接受
            </Button>
            <Button size="sm" variant="ghost" disabled={state.busy} onClick={onReject}>
              拒絕
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" disabled={state.busy} onClick={onExportSequence}>
          匯出 PNG 序列
        </Button>
        <Button size="sm" variant="ghost" disabled={state.busy} onClick={onRenderPreview}>
          渲染預覽
        </Button>
      </div>
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
  return move;
}

function complexityZh(c: string) {
  if (c === "VERY_HIGH") return "非常高";
  if (c === "HIGH") return "高";
  if (c === "MEDIUM") return "中";
  if (c === "LOW") return "低";
  return c;
}

function providerZh(p: string) {
  if (p.includes("linear-blend") || p.includes("preview")) return "快速預覽";
  if (p.includes("wan")) return "Wan（未載入）";
  if (p.includes("rife")) return p.includes("unavailable") ? "RIFE（未載入）" : "RIFE";
  return p;
}

function constraintZh(kind: string) {
  const k = kind.toLowerCase();
  if (k.includes("character")) return "角色";
  if (k.includes("face")) return "臉";
  if (k.includes("background")) return "背景";
  if (k.includes("contact")) return "接觸";
  if (k.includes("camera")) return "相機";
  if (k.includes("pose")) return "姿態";
  if (k.includes("track")) return "追蹤";
  if (k.includes("object")) return "物件";
  if (k.includes("hold")) return "跟隨";
  return kind.replaceAll("_", " ");
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
  return d;
}

function scoreKeyZh(k: string) {
  const x = k.toLowerCase();
  if (x.includes("character")) return "角色";
  if (x.includes("face")) return "臉";
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
