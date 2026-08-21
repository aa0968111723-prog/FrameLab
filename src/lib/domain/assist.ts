/** ASSIST mode structured response. Suggestions never auto-edit. */

import {
  explainMotion,
  type ProblemFrame,
  type ProblemRange,
  type ConsistencyFinding,
} from "./consistency-engine.ts";
import type { RepairPlan } from "./repair-planner.ts";
import type { MotionPairSummary } from "./motion-analysis.ts";

export const ASSIST_ACTIONS = [
  "VIEW_PROBLEM_FRAMES",
  "COMPARE_FRAMES",
  "RUN_MOTION_ANALYSIS",
  "RUN_POSE_ANALYSIS",
  "RUN_TRACKING",
  "CREATE_REPAIR_PLAN",
  "EXECUTE_REPAIR",
] as const;
export type AssistActionType = (typeof ASSIST_ACTIONS)[number];

export type AssistSuggestedAction = {
  type: "suggestion";
  action: AssistActionType;
  frame_range?: [number, number];
  label: string;
  auto?: false;
};

export type AssistResponse = {
  summary: string;
  problems: ProblemFrame[];
  problem_ranges: ProblemRange[];
  suggested_actions: AssistSuggestedAction[];
  repair_plan: RepairPlan | null;
  plan_id: string | null;
  findings: ConsistencyFinding[];
  context_label: string;
};

/** JSON-safe shape for TanStack server functions (no unknown / functions). */
export type AssistPayload = {
  summary: string;
  context_label: string;
  problems: Array<{
    frame_number: number;
    category: string;
    severity: string;
    score: number;
    reason: string;
    related_frames: number[];
  }>;
  problem_ranges: Array<{
    start: number;
    end: number;
    peak_frame: number;
    category: string;
    severity: string;
    score: number;
    reason: string;
    frames: number[];
  }>;
  suggested_actions: Array<{
    type: "suggestion";
    action: string;
    frame_range?: [number, number];
    label: string;
    auto?: false;
  }>;
  repair_plan: {
    problem_range: [number, number];
    repair_range: [number, number];
    protected_frames: number[];
    skipped_locked: number[];
    provider: string;
    reason: string;
    interpolation: "FULL_FRAME_INTERPOLATION";
  } | null;
  plan_id: string | null;
  findings: Array<{
    type: string;
    score: number;
    severity: string;
    explanation: string;
    frame: number;
  }>;
};

export function toAssistPayload(r: AssistResponse): AssistPayload {
  return {
    summary: r.summary,
    context_label: r.context_label,
    problems: r.problems.map((p) => ({
      frame_number: p.frame_number,
      category: p.category,
      severity: p.severity,
      score: p.score,
      reason: p.reason,
      related_frames: p.related_frames,
    })),
    problem_ranges: r.problem_ranges.map((x) => ({
      start: x.start,
      end: x.end,
      peak_frame: x.peak_frame,
      category: x.category,
      severity: x.severity,
      score: x.score,
      reason: x.reason,
      frames: x.frames,
    })),
    suggested_actions: r.suggested_actions.map((s) => ({
      type: "suggestion",
      action: s.action,
      frame_range: s.frame_range,
      label: s.label,
      auto: false,
    })),
    repair_plan: r.repair_plan
      ? {
          problem_range: r.repair_plan.problem_range,
          repair_range: r.repair_plan.repair_range,
          protected_frames: r.repair_plan.protected_frames,
          skipped_locked: r.repair_plan.skipped_locked,
          provider: r.repair_plan.provider,
          reason: r.repair_plan.reason,
          interpolation: "FULL_FRAME_INTERPOLATION",
        }
      : null,
    plan_id: r.plan_id,
    findings: r.findings.map((f) => ({
      type: f.type,
      score: f.score,
      severity: f.severity,
      explanation: f.explanation,
      frame: f.frame,
    })),
  };
}

export function buildAssistResponse(input: {
  findings: ConsistencyFinding[];
  problems: ProblemFrame[];
  ranges: ProblemRange[];
  plan?: RepairPlan | null;
  planId?: string | null;
  motion?: MotionPairSummary[];
  contextLabel: string;
}): AssistResponse {
  const ranges = input.ranges;
  const top = ranges[0];
  const summary = top
    ? `${input.contextLabel}：問題主要在 F${top.start}–F${top.end}（峰值 F${top.peak_frame}）。${top.reason}`
    : `${input.contextLabel}：運動／姿態／追蹤沒有超過警告門檻。`;
  const actions: AssistSuggestedAction[] = [];
  if (top) {
    actions.push({
      type: "suggestion",
      action: "VIEW_PROBLEM_FRAMES",
      frame_range: [top.start, top.end],
      label: `查看 F${top.start}–F${top.end}`,
      auto: false,
    });
    actions.push({
      type: "suggestion",
      action: "COMPARE_FRAMES",
      frame_range: [top.peak_frame, Math.min(top.end, top.peak_frame + 1)],
      label: `比對 F${top.peak_frame}`,
      auto: false,
    });
    actions.push({
      type: "suggestion",
      action: "CREATE_REPAIR_PLAN",
      frame_range: [top.start, top.end],
      label: "建立修復計畫",
      auto: false,
    });
    if (input.plan) {
      actions.push({
        type: "suggestion",
        action: "EXECUTE_REPAIR",
        frame_range: input.plan.repair_range,
        label: `修復 F${input.plan.repair_range[0]}–F${input.plan.repair_range[1]}（需確認）`,
        auto: false,
      });
    }
  } else {
    actions.push({
      type: "suggestion",
      action: "RUN_MOTION_ANALYSIS",
      label: "執行運動分析",
      auto: false,
    });
    actions.push({
      type: "suggestion",
      action: "RUN_POSE_ANALYSIS",
      label: "執行姿態精簡",
      auto: false,
    });
    actions.push({
      type: "suggestion",
      action: "RUN_TRACKING",
      label: "執行追蹤",
      auto: false,
    });
  }
  void input.motion;
  return {
    summary,
    problems: input.problems,
    problem_ranges: ranges,
    suggested_actions: actions,
    repair_plan: input.plan ?? null,
    plan_id: input.planId ?? null,
    findings: input.findings,
    context_label: input.contextLabel,
  };
}

export const ConsistencyExplanationBuilder = {
  motion: explainMotion,
  assist: buildAssistResponse,
};
