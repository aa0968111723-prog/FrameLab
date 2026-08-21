/** ASK/ASSIST conversation runtime. Talks to MCP tools via executeTool, never SQL. */

import { executeTool, type CommandContext } from "@/lib/commands/execute";
import { getLLMProvider, listLLMProviders, type LLMMessage } from "@/lib/ai/llm-provider";
import {
  ASK_MCP_TOOLS,
  ASSIST_MCP_TOOLS,
  buildConversationPrompt,
  buildFallbackAskReply,
  conversationTitleFromContext,
  formatPromptForProvider,
  isAskToolAllowed,
  isAssistToolAllowed,
  parseSuggestedActions,
  type ConversationMode,
  type InbetweenAskPayload,
} from "@/lib/domain/conversation";
import {
  toAssistPayload,
  type AssistPayload,
  type AssistResponse,
} from "@/lib/domain/assist";
import {
  effectiveContext,
  hydrateContext,
  serializeContext,
  type ContextLockState,
  type FrameLabContext,
  type SerializedContext,
} from "@/lib/domain/context-engine";
import { isInbetweenRequest, isCurveAdjustRequest, parseAnimationIntent } from "@/lib/domain/animation-intent";
import * as repo from "@/lib/framelab/repo";
import { nid } from "@/lib/domain/ids";
import { buildVisionAssets } from "./vision-assets.ts";
import { MCP_TOOLS } from "@/lib/mcp/catalog";

const ASK_SCOPES = ["READ", "ANALYZE"] as const;
const ASSIST_SCOPES = ["READ", "ANALYZE", "SUGGEST"] as const;

function askCtx(base: CommandContext, mode: ConversationMode = "ASK"): CommandContext {
  return {
    ...base,
    scopes: mode === "ASSIST" ? [...ASSIST_SCOPES] : [...ASK_SCOPES],
    source: "ui",
  };
}

async function callAskTool(
  ctx: CommandContext,
  conversationId: string,
  messageId: string | null,
  tool: string,
  args: Record<string, unknown>,
  mode: ConversationMode = "ASK",
) {
  const allowed = mode === "ASSIST" ? isAssistToolAllowed(tool) : isAskToolAllowed(tool);
  if (!allowed) {
    await repo.insertToolCallLog({
      conversationId,
      messageId,
      tool,
      args,
      status: "denied",
      durationMs: 0,
      resultSummary: `${mode} mode cannot EDIT/GENERATE/RENDER`,
    });
    return {
      ok: false as const,
      code: "PERMISSION_DENIED",
      error: `${mode} mode cannot call ${tool}`,
    };
  }
  const started = Date.now();
  const result = await executeTool(askCtx(ctx, mode), tool, args);
  await repo.insertToolCallLog({
    conversationId,
    messageId,
    tool,
    args,
    status: result.ok ? "ok" : "error",
    durationMs: Date.now() - started,
    resultSummary: result.ok
      ? JSON.stringify(result.data).slice(0, 400)
      : `${result.code}: ${result.error}`,
  });
  return result;
}

function parseSnap(raw: string | null | undefined): SerializedContext | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SerializedContext;
  } catch {
    return null;
  }
}

export async function loadSessionContext(
  userId: string,
  sessionId: string,
): Promise<FrameLabContext> {
  const session = await repo.getWorkspaceSession(userId, sessionId);
  if (!session) {
    return hydrateContext({
      project_id: null,
      video_id: null,
      timeline_id: null,
      current_frame: null,
      current_frame_id: null,
      timestamp_ms: null,
      selected_range: null,
      selected_frames: [],
      selected_character: null,
      selected_object: null,
      selected_region: null,
      onion_skin: {
        enabled: true,
        previousFrames: 2,
        nextFrames: 2,
        previousOpacity: 0.35,
        nextOpacity: 0.28,
      },
      overlay: {
        pose: false,
        mask: false,
        tracking: false,
        motion: false,
        depth: false,
        consistency: false,
      },
      neighbors_available: false,
      analysis_available: [],
      conversation_id: null,
      session_id: sessionId,
      context_version: 0,
      viewport: { zoom: 1 },
      focus: "current_project",
    });
  }
  const parsed = parseSnap(session.context_json);
  if (parsed) {
    return hydrateContext({ ...parsed, session_id: session.id, context_version: session.context_version });
  }
  return hydrateContext({
    project_id: session.project_id,
    video_id: session.video_id,
    timeline_id: session.timeline_id,
    current_frame: session.current_frame,
    current_frame_id: session.current_frame_id,
    timestamp_ms: null,
    selected_range: session.selected_range_json
      ? (JSON.parse(session.selected_range_json) as [number, number] | null)
      : null,
    selected_frames: JSON.parse(session.selected_frames_json || "[]") as number[],
    selected_character: session.selected_character_id,
    selected_object: session.selected_object_id,
    selected_region: session.selected_region_json
      ? JSON.parse(session.selected_region_json)
      : null,
    onion_skin: JSON.parse(session.onion_skin_json || "{}"),
    overlay: JSON.parse(session.overlay_json || "{}"),
    neighbors_available: session.current_frame != null,
    analysis_available: ["lightweight visual analysis"],
    conversation_id: session.conversation_id,
    session_id: session.id,
    context_version: session.context_version,
    viewport: { zoom: 1 },
    focus: "current_frame",
  });
}

function formatLightweight(data: unknown): string {
  if (!data || typeof data !== "object") return String(data ?? "");
  const d = data as {
    summary?: string;
    kind?: string;
    frames?: number[];
    limitations?: string[];
    available_metrics?: Record<string, number>;
    observations?: { kind: string; frames: number[]; value: number; note: string }[];
  };
  const lines = [
    d.kind === "lightweight visual analysis" ? "輕量視覺分析（像素，不是骨架）" : (d.kind ?? "輕量視覺分析"),
    d.summary ?? "",
    d.frames?.length ? `影格：${d.frames.map((n) => `F${n}`).join("、")}` : "",
  ];
  if (d.observations) {
    for (const o of d.observations.slice(0, 12)) {
      lines.push(
        `- ${obsKindZh(o.kind)} F${o.frames[0]}→F${o.frames[1]} = ${Number(o.value).toFixed(4)}（${o.note}）`,
      );
    }
  }
  if (d.limitations) {
    lines.push("限制：");
    for (const l of d.limitations) lines.push(`- ${l}`);
  }
  return lines.filter(Boolean).join("\n");
}

function obsKindZh(kind: string) {
  if (kind === "mae") return "像素差";
  if (kind === "histogram") return "色直方圖";
  if (kind === "luma") return "亮度";
  if (kind === "centroid") return "質心";
  if (kind === "edge") return "邊緣";
  if (kind === "ssim_like") return "結構近似";
  if (kind === "motion_block") return "區塊位移";
  return kind;
}

function formatAssist(data: unknown): string {
  if (!data || typeof data !== "object") return String(data ?? "");
  const d = data as {
    summary?: string;
    problems?: { frame_number: number; category: string; severity: string; reason: string }[];
    problem_ranges?: { start: number; end: number; peak_frame: number; severity: string; reason: string; category?: string }[];
    repair_plan?: { repair_range: [number, number]; protected_frames: number[]; reason: string } | null;
  };
  const lines = [d.summary ?? "協助分析完成"];
  for (const r of d.problem_ranges ?? []) {
    lines.push(
      `範圍 F${r.start}–F${r.end}，峰值 F${r.peak_frame}（${r.category ?? "問題"} · ${r.severity}）：${r.reason}`,
    );
  }
  for (const p of (d.problems ?? []).slice(0, 8)) {
    lines.push(`- F${p.frame_number} ${p.category} ${p.severity}：${p.reason}`);
  }
  if (d.repair_plan) {
    lines.push(
      `建議修復 F${d.repair_plan.repair_range[0]}–F${d.repair_plan.repair_range[1]}（受保護：${d.repair_plan.protected_frames.join("、") || "無"}）。尚未執行。`,
    );
  }
  return lines.join("\n");
}

function formatInbetweenPlan(data: unknown): string {
  if (!data || typeof data !== "object") return String(data ?? "");
  const d = data as {
    pair?: { start_frame_number?: number; end_frame_number?: number; desired_inbetween_count?: number };
    plan?: { curve?: string; constraints?: { kind: string }[]; breakdowns?: number[] };
    strategy?: { kind?: string; provider?: string; reason?: string };
    transition?: { complexity?: string; reasons?: string[] };
    warnings?: { constraint: string; message: string }[];
    confirmation?: { start?: number; end?: number; frames?: number; curve?: string; provider?: string };
    available?: boolean;
  };
  const start = d.confirmation?.start ?? d.pair?.start_frame_number;
  const end = d.confirmation?.end ?? d.pair?.end_frame_number;
  const count = d.confirmation?.frames ?? d.pair?.desired_inbetween_count;
  if ((d as { needPair?: boolean }).needPair) {
    const frame = (d as { frame?: number }).frame;
    return [
      frame != null ? `目前停在 F${frame}，只看到一格。` : "目前還沒有起點／終點關鍵影格。",
      "請先在時間軸點兩張不同的 ★，或按住 Shift 拉出範圍，或在「中間影格」面板按設為起點／終點。",
      "設好之後再說一次「幫我把這兩張中間補幀」。不會在只有一格的時候硬補。",
    ].join("\n");
  }
  const lines = [
    start != null && end != null
      ? `F${start} 到 F${end} 已做成關鍵影格對。`
      : "中間影格計畫",
  ];
  if (d.transition?.complexity) {
    lines.push(`轉場複雜度：${complexityZh(d.transition.complexity)}。`);
  }
  for (const r of d.transition?.reasons ?? []) lines.push(`- ${r}`);
  if (count != null) lines.push(`建議補 ${count} 格中間影格`);
  if (d.plan?.curve) lines.push(`運動曲線：${curveZh(d.plan.curve)}`);
  const cons = d.plan?.constraints?.map((c) => constraintKindZh(c.kind)) ?? [];
  if (cons.length) lines.push(`約束：${cons.join("、")}`);
  if (d.strategy?.reason) lines.push(d.strategy.reason);
  if (d.plan?.breakdowns?.length) {
    lines.push(`建議先在 F${d.plan.breakdowns[0]} 加分解影格，再補中間格。不會自動建立。`);
  }
  for (const w of d.warnings ?? []) lines.push(`⚠ ${w.message}`);
  lines.push("產生結果只是候選。請在畫面確認 — 協助模式不會直接寫入時間軸。");
  return lines.join("\n");
}

function formatCurveAdjust(data: unknown, intent: ReturnType<typeof parseAnimationIntent>): string {
  const d = (data && typeof data === "object" ? data : {}) as { curve?: string; start?: number | null; end?: number | null };
  const curve = d.curve ?? intent.curve ?? "ease_in_out";
  const start = d.start ?? intent.start_frame;
  const end = d.end ?? intent.end_frame;
  const regenStart = start != null ? start + 1 : null;
  const regenEnd = end != null ? end - 1 : null;
  const lines = [
    "不會重產整段。",
    `運動曲線：線性 → ${curveZh(curve)}`,
  ];
  if (regenStart != null && regenEnd != null && regenEnd >= regenStart) {
    lines.push(`重產範圍：F${regenStart}–F${regenEnd}（只改中間格；關鍵影格鎖定）。`);
  }
  lines.push("請在中間影格面板確認後套用。協助模式不會直接寫入時間軸。");
  return lines.join("\n");
}

function complexityZh(c: string) {
  if (c === "VERY_HIGH") return "非常高";
  if (c === "HIGH") return "高";
  if (c === "MEDIUM") return "中";
  if (c === "LOW") return "低";
  return c;
}

function curveZh(c: string) {
  if (c === "ease_in") return "緩入";
  if (c === "ease_out") return "緩出";
  if (c === "ease_in_out") return "緩入緩出";
  if (c === "hold") return "停留";
  if (c === "linear") return "線性";
  return c;
}

function constraintKindZh(kind: string) {
  const k = kind.toLowerCase();
  if (k.includes("character")) return "角色";
  if (k.includes("face")) return "臉";
  if (k.includes("background")) return "背景";
  if (k.includes("contact")) return "接觸";
  if (k.includes("camera")) return "相機";
  if (k.includes("object")) return "物件";
  return kind.replaceAll("_", " ");
}

function toInbetweenAsk(data: unknown): InbetweenAskPayload | null {
  if (!data || typeof data !== "object") return null;
  const d = data as {
    confirmation?: {
      title?: string;
      start?: number;
      end?: number;
      frames?: number;
      curve?: string;
      constraints?: string[];
      provider?: string;
      warnings?: { constraint: string; message: string }[];
      blocked?: boolean;
      reason?: string;
      suggested_breakdown?: number | null;
    };
    pair?: { start_frame_number?: number; end_frame_number?: number; desired_inbetween_count?: number };
    plan?: { version?: number; curve?: string; breakdowns?: number[]; constraints?: { kind: string }[]; spacing?: number[] };
    transition?: { complexity?: string; score?: number; reasons?: string[] };
    strategy?: { kind?: string; provider?: string; reason?: string };
    warnings?: { constraint: string; message: string }[];
  };
  return {
    confirmation: d.confirmation
      ? {
          title: d.confirmation.title ?? "產生中間影格",
          start: d.confirmation.start ?? d.pair?.start_frame_number ?? 0,
          end: d.confirmation.end ?? d.pair?.end_frame_number ?? 0,
          frames: d.confirmation.frames ?? d.pair?.desired_inbetween_count ?? 0,
          curve: d.confirmation.curve ?? d.plan?.curve ?? "ease_in_out",
          constraints: d.confirmation.constraints ?? [],
          provider: d.confirmation.provider ?? "rife",
          warnings: d.confirmation.warnings ?? d.warnings ?? [],
          blocked: Boolean(d.confirmation.blocked),
          reason: d.confirmation.reason ?? "",
          suggested_breakdown: d.confirmation.suggested_breakdown ?? d.plan?.breakdowns?.[0] ?? null,
        }
      : null,
    pair:
      d.pair?.start_frame_number != null && d.pair.end_frame_number != null
        ? {
            start_frame_number: d.pair.start_frame_number,
            end_frame_number: d.pair.end_frame_number,
            desired_inbetween_count: d.pair.desired_inbetween_count ?? 0,
          }
        : null,
    plan: d.plan
      ? {
          version: d.plan.version ?? 1,
          curve: d.plan.curve ?? "ease_in_out",
          breakdowns: d.plan.breakdowns ?? [],
          constraints: d.plan.constraints ?? [],
          spacing: d.plan.spacing ?? [],
        }
      : null,
    transition: d.transition
      ? {
          complexity: d.transition.complexity ?? "LOW",
          score: d.transition.score ?? 0,
          reasons: d.transition.reasons ?? [],
        }
      : null,
    strategy: d.strategy
      ? {
          kind: d.strategy.kind ?? "interpolation",
          provider: d.strategy.provider ?? "rife",
          reason: d.strategy.reason ?? "",
        }
      : null,
    warnings: d.warnings ?? [],
  };
}

function toolSpecs(mode: ConversationMode = "ASK") {
  const allow = mode === "ASSIST" ? ASSIST_MCP_TOOLS : ASK_MCP_TOOLS;
  return MCP_TOOLS.filter((t) => (allow as readonly string[]).includes(t.name)).map(
    (t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as Record<string, unknown>,
    }),
  );
}

export async function runAskTurn(input: {
  ctx: CommandContext;
  sessionId: string;
  conversationId?: string | null;
  providerId?: string | null;
  userMessage: string;
  liveContext?: FrameLabContext | null;
  lock?: ContextLockState;
  fps?: number;
  frameCount?: number;
  mode?: ConversationMode;
}): Promise<{
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  text: string;
  provider: { id: string; status: string; configured: boolean };
  suggestions: ReturnType<typeof parseSuggestedActions>;
  analysis: string;
  stale: boolean;
  toolStatus: string | null;
  snapshot: SerializedContext;
  assist: AssistPayload | null;
  inbetween: InbetweenAskPayload | null;
  curveAdjust: { curve: string; start: number | null; end: number | null } | null;
}> {
  const mode: ConversationMode = input.mode === "ASSIST" ? "ASSIST" : "ASK";
  const session = await repo.getWorkspaceSession(input.ctx.userId, input.sessionId);
  if (!session) {
    throw new Error("Invalid workspace session");
  }
  const live =
    input.liveContext ?? (await loadSessionContext(input.ctx.userId, input.sessionId));
  const lock: ContextLockState = input.lock ?? { locked: false, snapshot: null };
  const resolved = effectiveContext(live, lock);
  const snapshot = serializeContext(resolved);
  const stale = !lock.locked && snapshot.context_version < live.contextVersion;

  let conversationId = input.conversationId ?? null;
  if (conversationId) {
    const existing = await repo.getConversation(input.ctx.userId, conversationId);
    if (!existing) conversationId = null;
    else if (existing.context_locked && existing.locked_snapshot_json) {
      const frozen = parseSnap(existing.locked_snapshot_json);
      if (frozen) {
        Object.assign(snapshot, frozen);
      }
    }
  }
  if (!conversationId) {
    conversationId = nid("cnv");
    await repo.insertConversation({
      id: conversationId,
      userId: input.ctx.userId,
      projectId: session.project_id,
      timelineId: session.timeline_id,
      title: conversationTitleFromContext(resolved, input.userMessage),
      provider: input.providerId || "grok",
      mode,
      contextLocked: Boolean(lock.locked),
      lockedSnapshotJson: lock.locked ? JSON.stringify(snapshot) : "null",
      frameStart: snapshot.selected_range?.[0] ?? snapshot.current_frame,
      frameEnd: snapshot.selected_range?.[1] ?? snapshot.current_frame,
    });
  }

  const userMessageId = nid("msg");
  await repo.insertMessage({
    id: userMessageId,
    conversationId,
    role: "user",
    content: input.userMessage,
    contextSnapshotJson: JSON.stringify(snapshot),
    contextVersion: snapshot.context_version,
  });
  await repo.insertContextSnapshot({
    userId: input.ctx.userId,
    sessionId: input.sessionId,
    conversationId,
    messageId: userMessageId,
    snapshotJson: JSON.stringify(snapshot),
    contextVersion: snapshot.context_version,
  });

  const inbetweenAsk = mode === "ASSIST" && isInbetweenRequest(input.userMessage);
  const curveAsk = mode === "ASSIST" && !inbetweenAsk && isCurveAdjustRequest(input.userMessage);
  const parsedIntent = parseAnimationIntent(input.userMessage, {
    start: snapshot.selected_range?.[0] ?? snapshot.current_frame ?? 0,
    end: snapshot.selected_range?.[1] ?? snapshot.current_frame ?? 0,
  });
  const pairStart = parsedIntent.start_frame ?? snapshot.selected_range?.[0] ?? snapshot.current_frame ?? 0;
  const pairEnd = parsedIntent.end_frame ?? snapshot.selected_range?.[1] ?? snapshot.current_frame ?? 0;
  const needPair = inbetweenAsk && pairStart === pairEnd;
  const analysisResult = curveAsk
    ? {
        ok: true as const,
        data: {
          curve: parsedIntent.curve ?? "ease_in_out",
          start: parsedIntent.start_frame,
          end: parsedIntent.end_frame,
        },
      }
    : needPair
    ? {
        ok: true as const,
        data: { needPair: true, frame: pairStart },
      }
    : await callAskTool(
    input.ctx,
    conversationId,
    userMessageId,
    inbetweenAsk
      ? "create_inbetween_plan"
      : mode === "ASSIST"
        ? "suggest_repair"
        : "analyze_selection",
    inbetweenAsk
      ? {
          sessionId: input.sessionId,
          timelineId: snapshot.timeline_id,
          startFrame: parsedIntent.start_frame ?? snapshot.selected_range?.[0] ?? snapshot.current_frame ?? 0,
          endFrame: parsedIntent.end_frame ?? snapshot.selected_range?.[1] ?? snapshot.current_frame ?? 0,
          count: parsedIntent.count ?? undefined,
          curve: parsedIntent.curve ?? "ease_in_out",
          intent: input.userMessage,
          promoteKeys: true,
        }
      : mode === "ASSIST"
      ? {
          sessionId: input.sessionId,
          timelineId: snapshot.timeline_id,
          startFrame: snapshot.selected_range?.[0] ?? snapshot.current_frame ?? 0,
          endFrame: snapshot.selected_range?.[1] ?? snapshot.current_frame ?? 0,
          region: snapshot.selected_region ?? undefined,
          characterId: snapshot.selected_character ?? undefined,
        }
      : {
          sessionId: input.sessionId,
          analysis_types: ["visual", "motion"],
        },
    mode,
  );
  const assistPayload: AssistPayload | null =
    mode === "ASSIST" && !inbetweenAsk && !curveAsk && analysisResult.ok && analysisResult.data
      ? toAssistPayload(analysisResult.data as AssistResponse)
      : null;
  const analysisText = analysisResult.ok
    ? inbetweenAsk
      ? formatInbetweenPlan(analysisResult.data)
      : curveAsk
        ? formatCurveAdjust(analysisResult.data, parsedIntent)
        : mode === "ASSIST"
        ? formatAssist(analysisResult.data)
        : formatLightweight(analysisResult.data)
    : `分析失敗：${"error" in analysisResult ? analysisResult.error : "未知"}`;

  const built = buildConversationPrompt({
    ctx: resolved,
    userMessage: input.userMessage,
    analysisText,
    fps: input.fps,
    frameCount: input.frameCount,
    mode,
  });

  const provider = getLLMProvider(input.providerId);
  const info = listLLMProviders().find((p) => p.id === provider.id) ?? {
    id: provider.id,
    status: provider.status(),
    configured: provider.configured(),
  };

  let assistantText = "";
  let toolStatus: string | null = "正在讀取影格上下文…";

  if (!provider.configured()) {
    toolStatus = null;
    assistantText = buildFallbackAskReply({
      ctx: resolved,
      analysisText,
      frameCount: input.frameCount,
    });
  } else {
    toolStatus = "正在看選取的影格…";
    const images = await collectVision(input.ctx, resolved);
    const history = await repo.listMessages(conversationId);
    const messages: LLMMessage[] = [
      { role: "system", content: built.system },
      ...history.slice(-8).map((m) => ({
        role: m.role as LLMMessage["role"],
        content: m.content,
      })),
    ];
    messages.push({
      role: "user",
      content: formatPromptForProvider(built),
    });

    let round = await provider.chat({
      messages,
      tools: toolSpecs(mode),
      images,
      maxTokens: 700,
    });
    if (!round.ok) {
      assistantText = `${round.error}\n\n改用輕量分析：\n${analysisText}`;
    } else {
      let loops = 0;
      while (round.ok && round.toolCalls.length && loops < 2) {
        loops += 1;
        toolStatus = `正在呼叫 ${round.toolCalls[0].name}…`;
        messages.push({
          role: "assistant",
          content: round.text || "",
        });
        for (const tc of round.toolCalls) {
          toolStatus =
            tc.name === "compare_frames"
              ? "正在比對鄰近影格…"
              : tc.name === "analyze_motion_context" || tc.name === "analyze_selection"
                ? "正在看選取的影格…"
                : `正在呼叫 ${tc.name}…`;
          const toolArgs = { sessionId: input.sessionId, ...tc.arguments };
          const result = await callAskTool(
            input.ctx,
            conversationId,
            userMessageId,
            tc.name,
            toolArgs,
            mode,
          );
          messages.push({
            role: "tool",
            name: tc.name,
            toolCallId: tc.id,
            content: JSON.stringify(result).slice(0, 4000),
          });
        }
        round = await provider.chat({ messages, tools: toolSpecs(mode), maxTokens: 700 });
      }
      if (round.ok) assistantText = round.text || analysisText;
      else assistantText = `${round.error}\n\n${analysisText}`;
    }
    toolStatus = null;
  }

  const suggestions = parseSuggestedActions(
    assistantText,
    snapshot.selected_range ??
      (snapshot.current_frame != null
        ? [snapshot.current_frame, snapshot.current_frame]
        : null),
  );
  if (assistPayload) {
    for (const s of assistPayload.suggested_actions) {
      if (!suggestions.some((g) => g.action === s.action)) {
        suggestions.push({
          type: "suggestion",
          action: s.action as never,
          frame_range: s.frame_range,
          label: s.label ?? s.action,
        });
      }
    }
  }
  if (inbetweenAsk && analysisResult.ok && analysisResult.data && typeof analysisResult.data === "object") {
    const d = analysisResult.data as {
      pair?: { start_frame_number?: number; end_frame_number?: number };
      plan?: { breakdowns?: number[] };
      confirmation?: { start?: number; end?: number };
    };
    const a = d.confirmation?.start ?? d.pair?.start_frame_number ?? parsedIntent.start_frame ?? undefined;
    const b = d.confirmation?.end ?? d.pair?.end_frame_number ?? parsedIntent.end_frame ?? undefined;
    const range: [number, number] | undefined = a != null && b != null ? [a, b] : undefined;
    if (d.plan?.breakdowns?.length) {
      suggestions.push({
        type: "suggestion",
        action: "SUGGEST_BREAKDOWN",
        frame_range: range,
        frame: d.plan.breakdowns[0],
        label: `建議分解影格 F${d.plan.breakdowns[0]}`,
      });
      suggestions.push({
        type: "suggestion",
        action: "GENERATE_INBETWEENS",
        frame_range: range,
        label: "仍直接生成（需確認）",
      });
    } else {
      suggestions.push({
        type: "suggestion",
        action: "GENERATE_INBETWEENS",
        frame_range: range,
        label: "產生中間影格（需確認）",
      });
    }
  }
  if (curveAsk) {
    const a = parsedIntent.start_frame ?? undefined;
    const b = parsedIntent.end_frame ?? undefined;
    const range: [number, number] | undefined = a != null && b != null ? [a, b] : undefined;
    suggestions.push({
      type: "suggestion",
      action: "APPLY_CURVE",
      frame_range: range,
      label: `套用 ${parsedIntent.curve ?? "ease_in_out"} 並重新生成（需確認）`,
    });
  }
  const assistantMessageId = nid("msg");
  await repo.insertMessage({
    id: assistantMessageId,
    conversationId,
    role: "assistant",
    content: assistantText,
    contextSnapshotJson: JSON.stringify(snapshot),
    contextVersion: snapshot.context_version,
  });

  return {
    conversationId,
    userMessageId,
    assistantMessageId,
    text: assistantText,
    provider: {
      id: info.id,
      status: info.status,
      configured: info.configured,
    },
    suggestions,
    analysis: analysisText,
    stale,
    toolStatus,
    snapshot,
    assist: assistPayload,
    inbetween: inbetweenAsk && analysisResult.ok ? toInbetweenAsk(analysisResult.data) : null,
    curveAdjust: curveAsk
      ? {
          curve: parsedIntent.curve ?? "ease_in_out",
          start: parsedIntent.start_frame,
          end: parsedIntent.end_frame,
        }
      : null,
  };
}

async function collectVision(cmd: CommandContext, ctx: FrameLabContext) {
  if (!ctx.timelineId || ctx.currentFrame == null) return [];
  const current = await executeTool(askCtx(cmd), "get_frame", {
    frameId: ctx.currentFrame.id,
    timelineId: ctx.timelineId,
    frameNumber: ctx.currentFrame.frameNumber,
  });
  if (!current.ok) return [];
  const data = current.data as { imageData?: string; width?: number; height?: number };
  const neighborJpegs: { label: string; jpeg: string }[] = [];
  for (const delta of [-1, 1] as const) {
    const n = ctx.currentFrame.frameNumber + delta;
    if (n < 0) continue;
    const nb = await executeTool(askCtx(cmd), "get_frame", {
      timelineId: ctx.timelineId,
      frameNumber: n,
    });
    if (!nb.ok) continue;
    const img = (nb.data as { imageData?: string }).imageData;
    if (img) neighborJpegs.push({ label: delta < 0 ? `F${n} previous` : `F${n} next`, jpeg: img });
  }
  return buildVisionAssets({
    currentJpeg: data.imageData,
    currentLabel: `F${ctx.currentFrame.frameNumber}`,
    region: ctx.selectedRegion,
    frameWidth: data.width,
    frameHeight: data.height,
    neighborJpegs,
  });
}
