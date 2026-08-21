# Conversation Layer

ASK mode only. ASSIST / AGENT (suggested repair, auto-edit) are reserved.

## Path

```
UI  →  Application API (sendAskFn)
    →  Conversation Runtime (src/lib/conversation/runtime.ts)
    →  in-process executeTool (READ + ANALYZE)
    →  Context Engine snapshot + lightweight analysis
    →  LLM provider (Grok if XAI_API_KEY, else NOT_CONFIGURED)
```

The browser never holds an MCP token. The runtime calls `executeTool` with scopes `READ` and `ANALYZE` only. Vision crops for Grok go through `get_frame` (application command), never a SQL query in the conversation layer. `repair_frame`, `generate_inbetweens`, `render_*` are denied even if the user session is ADMIN.

## Persistence

Tables in `migrations/0006_conversation.sql`:

- `conversations` — title, provider, mode=ASK, optional locked snapshot, frame span
- `conversation_messages` — each row stores `context_snapshot_json` + `context_version`
- `conversation_tool_calls` — tool, args, status, duration, result summary (no binaries)
- `context_snapshots` — audit copy of what the model saw
- `region_selections` — history of canvas boxes

## Prompt

`buildConversationPrompt` (`ConversationContextBuilder.build`) emits separate blocks: system instructions, FrameLab context, analysis results, available tools, user message. The model is told not to invent joint angles.

Ask flushes the live workspace snapshot into `workspace_sessions` before `analyze_selection`, so the assistant never answers against a stale playhead/region.

## When the provider is missing

Runtime still runs `analyze_selection` (pixel MAE / histogram / centroid / 16×16 block). If Grok is not configured the assistant text is the analysis plus `AI provider is not configured.` / `NOT_CONFIGURED`. No fake Grok reply.

## Suggestions

The model (or the fallback) may emit:

```json
{"type":"suggestion","action":"ANALYZE_MOTION","frame_range":[135,138]}
```

The UI shows a button. The user must press it. That is not an edit.

Answers follow four parts: what is currently seen (frame / region / character / range / neighbors), what looks wrong, which context that is based on, and suggested next actions that are never auto-executed. When the provider is missing, `buildFallbackAskReply` still uses that shape plus `NOT_CONFIGURED`.

## Markers

Timeline shows a small message icon on frames covered by a conversation. The inspector lists threads and can reopen them.
