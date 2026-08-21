/** Conversation layer types, prompt builder, suggestion schema. ASK mode only. */

import {
  resolveAskContext,
  serializeContext,
  type FrameLabContext,
  type SerializedContext,
} from "./context-engine.ts";

export const CONVERSATION_MODES = ["ASK", "ASSIST", "AGENT"] as const;
export type ConversationMode = (typeof CONVERSATION_MODES)[number];

export const ENABLED_MODE: ConversationMode = "ASK";
export const ENABLED_MODES: ConversationMode[] = ["ASK", "ASSIST"];

export const SUGGESTED_ACTIONS = [
  "ANALYZE_POSE",
  "ANALYZE_MOTION",
  "ANALYZE_TRACKING",
  "COMPARE_FRAMES",
  "MARK_PROBLEM",
  "VIEW_PROBLEM_FRAMES",
  "RUN_MOTION_ANALYSIS",
  "RUN_POSE_ANALYSIS",
  "RUN_TRACKING",
  "CREATE_REPAIR_PLAN",
  "EXECUTE_REPAIR",
  "CREATE_INBETWEEN_PLAN",
  "GENERATE_INBETWEENS",
  "SUGGEST_BREAKDOWN",
  "APPLY_CURVE",
] as const;
export type SuggestedActionType = (typeof SUGGESTED_ACTIONS)[number];

export type SuggestedAction = {
  type: "suggestion";
  action: SuggestedActionType;
  frame_range?: [number, number];
  frame?: number;
  label: string;
};

export type InbetweenAskPayload = {
  confirmation: {
    title: string;
    start: number;
    end: number;
    frames: number;
    curve: string;
    constraints: string[];
    provider: string;
    warnings: { constraint: string; message: string }[];
    blocked: boolean;
    reason: string;
    suggested_breakdown: number | null;
  } | null;
  pair: { start_frame_number: number; end_frame_number: number; desired_inbetween_count: number } | null;
  plan: {
    version: number;
    curve: string;
    breakdowns: number[];
    constraints: { kind: string }[];
    spacing: number[];
  } | null;
  transition: { complexity: string; score: number; reasons: string[] } | null;
  strategy: { kind: string; provider: string; reason: string } | null;
  warnings: { constraint: string; message: string }[];
};

export const ASK_MCP_TOOLS = [
  "get_current_context",
  "get_current_frame",
  "get_selected_frames",
  "get_selected_frame_range",
  "get_selected_range",
  "get_selected_region",
  "get_frame_neighbors",
  "get_current_character",
  "get_current_object",
  "analyze_selection",
  "compare_frames",
  "analyze_motion_context",
  "get_frame_analysis",
  "get_consistency_results",
  "get_visual_context",
  "get_motion_path",
  "get_pose_overlay",
  "get_tracking_overlay",
  "get_problem_regions",
  "focus_problem",
  "compare_frames_visual",
  "list_visual_annotations",
] as const;

export const FORBIDDEN_ASK_TOOLS = [
  "repair_frame",
  "repair_frame_range",
  "regenerate_region",
  "generate_inbetweens",
  "interpolate_frames",
  "replace_frame",
  "delete_frame",
  "add_frame",
  "insert_frame",
  "clear_frame",
  "hold_frame",
  "duplicate_frame",
  "create_breakdown",
  "extract_video",
  "ingest_frames",
  "render_preview",
  "render_frame_range",
  "render_animation",
  "execute_repair_plan",
  "accept_revision",
  "restore_revision",
  "accept_generated_frames",
  "regenerate_inbetween_range",
  "generate_breakdown_frame",
] as const;

export const ASSIST_MCP_TOOLS = [
  ...ASK_MCP_TOOLS,
  "analyze_motion",
  "analyze_pose",
  "analyze_tracking",
  "analyze_consistency",
  "detect_problem_frames",
  "get_problem_ranges",
  "create_repair_plan",
  "suggest_repair",
  "compare_before_after",
  "create_inbetween_plan",
  "create_motion_plan",
  "suggest_breakdown_frames",
  "analyze_keyframe_transition",
  "get_motion_plan",
  "annotate_frame",
  "highlight_region",
  "highlight_frame_range",
] as const;

export function isAskToolAllowed(tool: string): boolean {
  if ((FORBIDDEN_ASK_TOOLS as readonly string[]).includes(tool)) return false;
  return (ASK_MCP_TOOLS as readonly string[]).includes(tool);
}

export function isAssistToolAllowed(tool: string): boolean {
  if ((FORBIDDEN_ASK_TOOLS as readonly string[]).includes(tool)) return false;
  return (ASSIST_MCP_TOOLS as readonly string[]).includes(tool);
}

export type ConversationRecord = {
  id: string;
  projectId: string;
  timelineId: string | null;
  title: string;
  provider: string;
  mode: ConversationMode;
  contextLocked: boolean;
  frameStart: number | null;
  frameEnd: number | null;
};

export type ConversationMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  contextSnapshot: SerializedContext | null;
  contextVersion: number;
  createdAt: string;
  stale?: boolean;
  suggestions?: SuggestedAction[];
  toolStatus?: string | null;
};

export type BuiltPrompt = {
  system: string;
  contextBlock: string;
  userMessage: string;
  tools: readonly string[];
  analysisBlock: string;
};

const SYSTEM = [
  "You are FrameLab's animation assistant, looking at the same timeline as the animator.",
  "Mode: ASK or ASSIST — read and analyze only unless the user confirms a repair in the UI.",
  "Always answer the animator in Traditional Chinese (Taiwan).",
  "Keep frame numbers (F135), tool names, and JSON suggestion lines unchanged.",
  "Ground every claim in FrameLab context or analysis results provided below.",
  "If pose / mask / depth / identity scores are missing, say they are unavailable. Do not invent joint angles.",
  "Prefer frame numbers (F135) and selected-region language over vague 'the image'.",
  "When metrics exist, quote them (velocity ratio, tracking break, contact heuristic). Do not say 'it might look jumpy'.",
  "Answer in this order:",
  "1. What you currently see (frame, region, character, range, neighbors).",
  "2. What looks wrong, if anything — grounded in the analysis block.",
  "3. Which context that judgment is based on.",
  "4. Suggested next actions. Never auto-execute. Never claim you already repaired frames.",
  "When the user asks to fill inbetweens, suggest CREATE_INBETWEEN_PLAN then GENERATE_INBETWEENS. Never call generate_inbetweens yourself.",
  "When suggesting, emit a JSON line: {\"type\":\"suggestion\",\"action\":\"ANALYZE_MOTION\",\"frame_range\":[135,138]}.",
  "Lightweight visual analysis is pixel MAE / histogram / centroid — label it as such, never as AI pose.",
  "framelab-pose-lite is silhouette extrema, not RTMPose. block-match-16 is not SEA-RAFT. Contact breaks are heuristics.",
].join("\n");

export function buildConversationPrompt(input: {
  ctx: FrameLabContext;
  userMessage: string;
  analysisText?: string;
  fps?: number;
  frameCount?: number;
  mode?: ConversationMode;
}): BuiltPrompt {
  const snap = serializeContext(input.ctx);
  const resolved = resolveAskContext(input.ctx, input.frameCount ?? 0);
  const region = snap.selected_region;
  const lines = [
    "CURRENT PROJECT",
    `Project ID: ${snap.project_id ?? "(none)"}`,
    `Video ID: ${snap.video_id ?? "(none)"}`,
    "",
    "CURRENT TIMELINE",
    `Timeline ID: ${snap.timeline_id ?? "(none)"}`,
    `FPS: ${input.fps ?? 24}`,
    "",
    "CURRENT FRAME",
    snap.current_frame != null
      ? `Frame: ${snap.current_frame}  Timestamp: ${((snap.timestamp_ms ?? 0) / 1000).toFixed(3)}s  id=${snap.current_frame_id}`
      : "Frame: (none)",
    "",
    "SELECTED RANGE",
    snap.selected_range
      ? `${snap.selected_range[0]}–${snap.selected_range[1]}`
      : "(none)",
    "",
    "SELECTED REGION",
    region
      ? `type=${region.selectionType} frame=${region.frameNumber} normalized x=${region.x.toFixed(3)} y=${region.y.toFixed(3)} w=${region.width.toFixed(3)} h=${region.height.toFixed(3)}`
      : "(none)",
    "",
    "CHARACTER / OBJECT",
    `character: ${snap.selected_character ?? "(none)"}`,
    `object: ${snap.selected_object ?? "(none)"}`,
    "",
    "ONION SKIN",
    `enabled=${snap.onion_skin.enabled} previous=${snap.onion_skin.previousFrames} next=${snap.onion_skin.nextFrames}`,
    "",
    "NEIGHBOR FRAMES",
    resolved.neighbors.length
      ? resolved.neighbors.map((n) => (n === snap.current_frame ? `F${n} (current)` : `F${n}`)).join(", ")
      : "(none)",
    "",
    "FOCUS",
    resolved.focus,
    resolved.summary,
    "",
    "AVAILABLE ANALYSIS",
    snap.analysis_available.length
      ? snap.analysis_available.join(", ")
      : "Lightweight visual diff (pixel metrics). Pose/mask/depth not loaded.",
  ];
  return {
    system: SYSTEM,
    contextBlock: lines.join("\n"),
    userMessage: input.userMessage,
    tools: input.mode === "ASSIST" ? ASSIST_MCP_TOOLS : ASK_MCP_TOOLS,
    analysisBlock: input.analysisText?.trim()
      ? `ANALYSIS RESULTS\n${input.analysisText.trim()}`
      : "ANALYSIS RESULTS\n(none yet — call analyze_selection if needed)",
  };
}

export function formatPromptForProvider(built: BuiltPrompt): string {
  return [
    built.contextBlock,
    "",
    built.analysisBlock,
    "",
    "AVAILABLE TOOLS",
    built.tools.join(", "),
    "",
    "USER MESSAGE",
    built.userMessage,
  ].join("\n");
}

export const SUGGESTED_ACTION_ALIASES: Record<string, SuggestedActionType> = {
  run_motion_analysis: "ANALYZE_MOTION",
  run_pose_analysis: "ANALYZE_POSE",
  run_tracking_analysis: "ANALYZE_TRACKING",
  compare_frames: "COMPARE_FRAMES",
  mark_problem: "MARK_PROBLEM",
  view_problem_frames: "VIEW_PROBLEM_FRAMES",
  create_repair_plan: "CREATE_REPAIR_PLAN",
  execute_repair: "EXECUTE_REPAIR",
  RUN_MOTION_ANALYSIS: "ANALYZE_MOTION",
  RUN_POSE_ANALYSIS: "ANALYZE_POSE",
  RUN_TRACKING: "ANALYZE_TRACKING",
};

export function parseSuggestedActions(
  text: string,
  fallbackRange?: [number, number] | null,
): SuggestedAction[] {
  const out: SuggestedAction[] = [];
  const re = /\{\s*"type"\s*:\s*"suggestion"[\s\S]*?\}/g;
  const matches = text.match(re) ?? [];
  for (const raw of matches) {
    try {
      const parsed = JSON.parse(raw) as {
        type?: string;
        action?: string;
        frame_range?: number[];
      };
      if (parsed.type !== "suggestion") continue;
      const rawAction = parsed.action ?? "";
      const action = (
        (SUGGESTED_ACTIONS as readonly string[]).includes(rawAction)
          ? rawAction
          : SUGGESTED_ACTION_ALIASES[rawAction]
      ) as SuggestedActionType | undefined;
      if (!action || !(SUGGESTED_ACTIONS as readonly string[]).includes(action)) continue;
      const range =
        parsed.frame_range && parsed.frame_range.length === 2
          ? ([parsed.frame_range[0], parsed.frame_range[1]] as [number, number])
          : fallbackRange ?? undefined;
      out.push({
        type: "suggestion",
        action,
        frame_range: range,
        label: labelFor(action, range),
      });
    } catch {
      /* ignore malformed */
    }
  }
  if (out.length === 0 && /motion|pose|tracking|compare/i.test(text) && fallbackRange) {
    if (/motion/i.test(text)) {
      out.push({
        type: "suggestion",
        action: "ANALYZE_MOTION",
        frame_range: fallbackRange,
        label: labelFor("ANALYZE_MOTION", fallbackRange),
      });
    }
  }
  return out;
}

function labelFor(action: SuggestedActionType, range?: [number, number]): string {
  const span = range ? ` F${range[0]}–F${range[1]}` : "";
  switch (action) {
    case "ANALYZE_POSE":
      return `分析姿態${span}`;
    case "ANALYZE_MOTION":
      return `分析運動${span}`;
    case "ANALYZE_TRACKING":
      return `分析追蹤${span}`;
    case "COMPARE_FRAMES":
      return `比對影格${span}`;
    case "MARK_PROBLEM":
      return `標記問題${span}`;
    case "VIEW_PROBLEM_FRAMES":
      return `查看問題影格${span}`;
    case "RUN_MOTION_ANALYSIS":
      return `執行運動分析${span}`;
    case "RUN_POSE_ANALYSIS":
      return `執行姿態精簡${span}`;
    case "RUN_TRACKING":
      return `執行追蹤${span}`;
    case "CREATE_REPAIR_PLAN":
      return `建立修復計畫${span}`;
    case "EXECUTE_REPAIR":
      return `執行修復${span}（需確認）`;
    case "CREATE_INBETWEEN_PLAN":
      return `建立中間影格計畫${span}`;
    case "GENERATE_INBETWEENS":
      return `產生中間影格${span}`;
    case "SUGGEST_BREAKDOWN":
      return `建議分解影格${span}`;
    case "APPLY_CURVE":
      return `套用運動曲線${span}`;
    default:
      return action;
  }
}

export const ConversationContextBuilder = {
  build: buildConversationPrompt,
  format: formatPromptForProvider,
};

export function conversationTitleFromContext(
  ctx: FrameLabContext,
  userMessage: string,
): string {
  const f = ctx.currentFrame?.frameNumber;
  const region = ctx.selectedRegion ? " 選區" : "";
  const range = ctx.selectedRange
    ? ` F${ctx.selectedRange.startFrame}–${ctx.selectedRange.endFrame}`
    : f != null
      ? ` F${f}`
      : "";
  const clip = userMessage.trim().slice(0, 42) || "工作區提問";
  return `${clip}${range}${region}`.trim();
}

/** Honest ASK fallback when the LLM provider is missing. Follows the four-part answer shape. */
export function buildFallbackAskReply(input: {
  ctx: FrameLabContext;
  analysisText: string;
  frameCount?: number;
}): string {
  const snap = serializeContext(input.ctx);
  const resolved = resolveAskContext(input.ctx, input.frameCount ?? 0);
  const frame = snap.current_frame;
  const region = snap.selected_region;
  const range = snap.selected_range;
  const neighbors = resolved.neighbors.filter((n) => n !== frame);
  const sees: string[] = [];
  if (frame != null) sees.push(`影格 ${frame}`);
  if (region) {
    sees.push(
      `已選區域（正規化 x=${region.x.toFixed(2)} y=${region.y.toFixed(2)} w=${region.width.toFixed(2)} h=${region.height.toFixed(2)}）`,
    );
  }
  if (snap.selected_character) sees.push(`角色 ${snap.selected_character}`);
  if (range && range[0] !== range[1]) sees.push(`範圍 F${range[0]}–F${range[1]}`);
  if (neighbors.length) sees.push(`鄰近 ${neighbors.map((n) => `F${n}`).join("、")}`);

  const motionRange: [number, number] | null =
    range && range[0] !== range[1]
      ? [range[0], range[1]]
      : frame != null
        ? [Math.max(0, frame - 1), frame]
        : null;
  const suggestions: string[] = [];
  if (motionRange) {
    suggestions.push(
      `{"type":"suggestion","action":"ANALYZE_MOTION","frame_range":[${motionRange[0]},${motionRange[1]}]}`,
    );
    suggestions.push(
      `{"type":"suggestion","action":"COMPARE_FRAMES","frame_range":[${motionRange[0]},${motionRange[1]}]}`,
    );
    suggestions.push(
      `{"type":"suggestion","action":"MARK_PROBLEM","frame_range":[${motionRange[0]},${motionRange[1]}]}`,
    );
  }

  return [
    `目前在看 ${sees.join("、") || "工作區"}。`,
    "",
    "看起來不對勁的地方：",
    input.analysisText ||
      "輕量視覺分析還沒抓到運動突變。姿態也還沒有資料。",
    "",
    "依據：",
    "- FrameLab 上下文快照（不是空對話）",
    `- 洋蔥皮 ${snap.onion_skin.enabled ? `前 ${snap.onion_skin.previousFrames} / 後 ${snap.onion_skin.nextFrames}` : "關"}`,
    "- 輕量視覺分析（像素 MAE／直方圖／質心 — 不是骨架）",
    "",
    "建議下一步（尚未執行）：",
    ...suggestions,
    "",
    "尚未設定 AI 供應商。",
    "NOT_CONFIGURED — 不會假裝有回覆。",
  ].join("\n");
}
