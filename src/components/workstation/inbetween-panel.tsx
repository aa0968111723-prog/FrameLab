/** Inspector Inbetween panel — plan → confirm → candidate → accept. Never auto-writes. */

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
  previousFrames?: { frameNumber: number; motion_progress: number; thumbnailData: string }[];
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
  onMarkBreakdown,
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
  onMarkBreakdown: (n: number) => void;
  onViewCandidate: () => void;
  onSeekCandidate: (n: number) => void;
  onCompareCandidates: () => void;
  onExportSequence: () => void;
  onRenderPreview: () => void;
}) {
  const gap =
    state.start != null && state.end != null ? Math.max(0, state.end - state.start) : null;
  const generated = gap != null ? Math.max(0, gap - 1) : state.count;

  return (
    <div className="space-y-3 rounded-[var(--radius-sm)] border border-border bg-subtle p-3">
      <p className="text-xs uppercase tracking-wide text-faint">Inbetween</p>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-faint">Start</p>
          <p className="font-mono text-sm">
            {state.start != null ? `F${state.start} ★` : "—"}
          </p>
          <Button size="sm" variant="ghost" onClick={onSetStart} disabled={state.busy}>
            Set F{currentFrame}
          </Button>
        </div>
        <div>
          <p className="text-faint">End</p>
          <p className="font-mono text-sm">
            {state.end != null ? `F${state.end} ★` : "—"}
          </p>
          <Button size="sm" variant="ghost" onClick={onSetEnd} disabled={state.busy}>
            Set F{currentFrame}
          </Button>
        </div>
      </div>
      {selectedRange && (
        <Button size="sm" variant="ghost" onClick={onUseRange} disabled={state.busy}>
          Use range F{selectedRange[0]}–F{selectedRange[1]}
        </Button>
      )}
      {gap != null && (
        <p className="text-[11px] text-muted">
          Gap: {gap} frames · Generated: {generated}
        </p>
      )}
      <label className="block text-xs text-muted">
        Frames
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
        <legend className="text-xs text-muted">Motion</legend>
        {(["linear", "ease_in", "ease_out", "ease_in_out", "hold"] as const).map((c) => (
          <label key={c} className="flex items-center gap-2 text-[11px] text-fg">
            <input
              type="radio"
              name="motion-curve"
              checked={state.curve === c}
              onChange={() => onCurve(c)}
            />
            {c === "linear"
              ? "Linear"
              : c === "ease_in"
                ? "Ease In"
                : c === "ease_out"
                  ? "Ease Out"
                  : c === "ease_in_out"
                    ? "Ease In Out"
                    : "Hold"}
          </label>
        ))}
      </fieldset>
      <label className="block text-xs text-muted">
        Quality
        <select
          className="mt-1 h-9 w-full rounded-[var(--radius-sm)] border border-border bg-subtle px-2 text-sm text-fg"
          value={state.quality}
          onChange={(e) => onQuality(e.target.value === "production" ? "production" : "preview")}
        >
          <option value="preview">Preview</option>
          <option value="production">Production</option>
        </select>
      </label>
      <p className="text-[11px] text-faint">Provider: Auto (linear-blend). Wan / RIFE / ComfyUI unavailable.</p>
      <fieldset className="space-y-1">
        <legend className="text-xs text-muted">Constraints</legend>
        {(
          [
            ["preserveCharacter", "Character"],
            ["preserveFace", "Face"],
            ["preserveBackground", "Background"],
            ["maintainContact", "Hand ↔ Suitcase"],
            ["keepCameraStatic", "Camera static"],
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
          <p className="text-xs uppercase tracking-wide text-faint">Motion Plan v{state.plan.version}</p>
          <p className="text-muted">
            Curve {state.plan.curve}
            {state.plan.timing ? ` · ${state.plan.timing.frames} frames @ ${state.plan.timing.fps} fps` : ""}
          </p>
          <p className="text-muted">Camera: {state.plan.camera?.movement ?? "unknown"}</p>
          {(state.plan.characters ?? []).length > 0 ? (
            <ul className="text-fg">
              {(state.plan.characters ?? []).map((c) => (
                <li key={c.character_id}>
                  Character {String(c.pose_transition?.name ?? c.character_id.slice(0, 8))} · {c.motion.direction} · dist{" "}
                  {c.motion.distance_normalized.toFixed(2)}
                  {typeof c.pose_transition.pose_displacement === "number"
                    ? ` · pose Δ ${Number(c.pose_transition.pose_displacement).toFixed(2)}`
                    : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-faint">No character assignment on the start key.</p>
          )}
          {(state.plan.objects ?? []).length > 0 && (
            <ul>
              {(state.plan.objects ?? []).map((o) => (
                <li key={o.object_id}>Object {o.constraint}</li>
              ))}
            </ul>
          )}
          {(state.plan.constraints ?? []).length > 0 && (
            <p className="text-muted">
              Constraints: {(state.plan.constraints ?? []).map((c) => c.kind.replaceAll("_", " ")).join(" · ")}
            </p>
          )}
          {(state.plan.breakdowns ?? []).length > 0 && (
            <p className="text-muted">Breakdowns: {(state.plan.breakdowns ?? []).map((n) => `F${n}`).join(", ")}</p>
          )}
          {(state.plan.spacing ?? []).length > 0 && (
            <p className="font-mono text-faint">
              Spacing {state.plan.spacing!.slice(0, 9).map((s) => s.toFixed(2)).join(" ")}
            </p>
          )}
        </div>
      )}
      {state.analysis && (
        <div className="space-y-1 text-[11px] text-muted">
          <p>
            Complexity {state.analysis.complexity} ({Math.round(state.analysis.score * 100)}%)
          </p>
          <p>{state.analysis.strategy.reason}</p>
          {state.analysis.suggest_breakdown && state.analysis.suggested_breakdown != null && (
            <Button
              size="sm"
              variant="secondary"
              disabled={state.busy}
              onClick={() => onMarkBreakdown(state.analysis!.suggested_breakdown!)}
            >
              建立 Breakdown F{state.analysis.suggested_breakdown}
            </Button>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="secondary" disabled={state.busy} onClick={onAnalyze}>
          Analyze Transition
        </Button>
        <Button size="sm" variant="secondary" disabled={state.busy} onClick={onPlan}>
          <Sparkles className="size-3.5" />
          Generate
        </Button>
      </div>

      {state.confirmation && (
        <div className="space-y-2 rounded-[var(--radius-sm)] border border-accent/40 bg-raised p-2">
          <p className="text-xs font-medium">{state.confirmation.title}</p>
          <p className="font-mono text-[11px] text-muted">
            F{state.confirmation.start} → F{state.confirmation.end}
          </p>
          <ul className="text-[11px] text-muted">
            <li>Frames: {state.confirmation.frames}</li>
            <li>Motion: {state.confirmation.curve}</li>
            <li>Provider: {state.confirmation.provider}</li>
          </ul>
          {state.confirmation.constraints.length > 0 && (
            <ul className="text-[11px] text-fg">
              {state.confirmation.constraints.map((c) => (
                <li key={c}>✓ {c}</li>
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
                  onClick={() => onMarkBreakdown(state.confirmation!.suggested_breakdown!)}
                >
                  建立 Breakdown F{state.confirmation.suggested_breakdown}
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={state.busy} onClick={onForceGenerate}>
                仍直接生成
              </Button>
            </div>
          ) : (
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" disabled={state.busy} onClick={onConfirmGenerate}>
                Generate
              </Button>
              <Button size="sm" variant="ghost" disabled={state.busy} onClick={onCancelConfirm}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}

      {state.candidate && (
        <div className="space-y-2 rounded-[var(--radius-sm)] border border-gen/40 p-2">
          <p className="text-xs font-medium">
            {state.candidate.count} frames generated · {state.candidate.provider} · {state.candidate.quality}
          </p>
          <p className="text-[11px] text-faint">Candidate only — active timeline unchanged.</p>
          {state.candidate.frames.length > 0 && (
            <div className="flex gap-1 overflow-x-auto scrollbar-thin">
              {state.candidate.frames.map((f) => (
                <button key={f.frameNumber} type="button" onClick={() => onSeekCandidate(f.frameNumber)} className="w-10 shrink-0">
                  <span className="block h-10 w-10 overflow-hidden rounded-[var(--radius-xs)] border border-gen/40">
                    {f.thumbnailData ? (
                      <img
                        src={f.thumbnailData.startsWith("data:") ? f.thumbnailData : `data:image/jpeg;base64,${f.thumbnailData}`}
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
                  <span className="text-faint">{k.replaceAll("_", " ")}</span>
                  <span className={v < 0.8 ? "text-warn" : "text-fg"}>{Math.round(v * 100)}%{v < 0.8 ? " ⚠" : ""}</span>
                </li>
              ))}
            </ul>
          )}
          {(state.candidate.evaluation?.problems ?? []).length > 0 && (
            <div className="text-[11px] text-warn">
              <p>Problems:</p>
              <ul>
                {(state.candidate.evaluation?.problems ?? []).slice(0, 6).map((p) => (
                  <li key={`${p.frame_number}-${p.category}`}>
                    F{p.frame_number} {p.category}
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
              View
            </Button>
            {state.candidate.previousCandidateId && (state.candidate.previousFrames?.length ?? 0) > 0 && (
              <Button size="sm" variant="secondary" disabled={state.busy} onClick={onCompareCandidates}>
                Compare A / B
              </Button>
            )}
            {(state.candidate.evaluation?.problems ?? []).length > 0 && (
              <Button size="sm" variant="secondary" disabled={state.busy} onClick={onRegenerate}>
                Regenerate problem frames
              </Button>
            )}
            <Button size="sm" variant="secondary" disabled={state.busy} onClick={onAccept}>
              Accept
            </Button>
            <Button size="sm" variant="ghost" disabled={state.busy} onClick={onReject}>
              Reject
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" disabled={state.busy} onClick={onExportSequence}>
          Export PNG sequence
        </Button>
        <Button size="sm" variant="ghost" disabled={state.busy} onClick={onRenderPreview}>
          Render preview
        </Button>
      </div>
    </div>
  );
}
