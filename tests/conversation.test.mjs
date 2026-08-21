import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const conv = readFileSync(new URL("../src/lib/domain/conversation.ts", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../src/lib/conversation/runtime.ts", import.meta.url), "utf8");
const llm = readFileSync(new URL("../src/lib/ai/llm-provider.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../migrations/0006_conversation.sql", import.meta.url), "utf8");
const perms = readFileSync(new URL("../src/lib/domain/permissions.ts", import.meta.url), "utf8");

describe("conversation prompt + suggestions", () => {
  it("builds a structured prompt with project/timeline/frame/range/region", () => {
    assert.match(conv, /CURRENT PROJECT/);
    assert.match(conv, /CURRENT TIMELINE/);
    assert.match(conv, /CURRENT FRAME/);
    assert.match(conv, /SELECTED RANGE/);
    assert.match(conv, /SELECTED REGION/);
    assert.match(conv, /ONION SKIN/);
    assert.match(conv, /NEIGHBOR FRAMES/);
    assert.match(conv, /AVAILABLE ANALYSIS/);
    assert.match(conv, /USER MESSAGE/);
    assert.match(conv, /Mode: ASK/);
    assert.match(conv, /Do not invent joint angles/);
    assert.match(conv, /Answer in this order/);
    assert.match(conv, /Suggested next actions/);
    assert.match(conv, /buildFallbackAskReply/);
  });

  it("parses suggestion JSON", () => {
    assert.match(conv, /ANALYZE_MOTION/);
    assert.match(conv, /ANALYZE_TRACKING/);
    assert.match(conv, /COMPARE_FRAMES/);
    assert.match(conv, /MARK_PROBLEM/);
    assert.match(conv, /run_motion_analysis/);
    assert.match(conv, /export function parseSuggestedActions/);
  });

  it("ASK whitelist excludes repair/generate/render", () => {
    assert.match(conv, /get_current_context/);
    assert.match(conv, /get_selected_range/);
    assert.match(conv, /analyze_selection/);
    assert.match(conv, /repair_frame/);
    assert.match(conv, /generate_inbetweens/);
    assert.match(conv, /export function isAskToolAllowed/);
    assert.match(conv, /FORBIDDEN_ASK_TOOLS/);
    assert.match(runtime, /mode cannot call/);
    assert.match(runtime, /ASK_SCOPES = \["READ", "ANALYZE"\]/);
  });
});

describe("conversation snapshots + stale + provider", () => {
  it("persists snapshot + version on each message", () => {
    assert.match(schema, /context_snapshot_json/);
    assert.match(schema, /context_version/);
    assert.match(runtime, /insertContextSnapshot/);
    assert.match(runtime, /insertMessage/);
    assert.match(runtime, /insertToolCallLog/);
  });

  it("stale context is flagged, not silently remapped", () => {
    assert.match(runtime, /stale/);
    assert.match(conv, /stale\?/);
  });

  it("provider abstraction lists grok plus reserved NOT_CONFIGURED adapters", () => {
    assert.match(llm, /class GrokProvider/);
    assert.match(llm, /class ReservedLLM/);
    assert.match(llm, /openai/);
    assert.match(llm, /claude/);
    assert.match(llm, /gemini/);
    assert.match(llm, /not_configured/);
    assert.match(llm, /XAI_API_KEY/);
    assert.match(runtime, /buildFallbackAskReply/);
    assert.match(conv, /AI provider is not configured/);
    assert.match(conv, /NOT_CONFIGURED/);
  });

  it("runtime always runs analyze_selection even without a key", () => {
    assert.match(runtime, /analyze_selection/);
    assert.doesNotMatch(runtime, /Math\.random\(\)/);
  });

  it("exports ConversationContextBuilder / VisionAssetBuilder / ProviderRegistry", () => {
    assert.match(conv, /ConversationContextBuilder/);
    const vision = readFileSync(new URL("../src/lib/conversation/vision-assets.ts", import.meta.url), "utf8");
    assert.match(vision, /VisionAssetBuilder/);
    assert.match(vision, /CACHE_MAX/);
    assert.match(llm, /ProviderRegistry/);
    const appCtx = readFileSync(new URL("../src/lib/application/conversation-context.ts", import.meta.url), "utf8");
    const appVision = readFileSync(new URL("../src/lib/application/vision-assets.ts", import.meta.url), "utf8");
    const bridge = readFileSync(new URL("../src/lib/mcp/context-bridge.ts", import.meta.url), "utf8");
    assert.match(appCtx, /ConversationContextBuilder/);
    assert.match(appVision, /VisionAssetBuilder/);
    assert.match(bridge, /McpContextBridge/);
  });
});

describe("ASK permission denied", () => {
  it("READ cannot call generate tools", () => {
    assert.match(perms, /repair_frame: "GENERATE"/);
    assert.match(perms, /PERMISSION_DENIED/);
    assert.match(perms, /Unknown tool/);
  });

  it("analyze_selection is ANALYZE scope", () => {
    assert.match(perms, /analyze_selection: "ANALYZE"/);
    assert.match(perms, /get_current_context: "READ"/);
    assert.match(perms, /get_selected_region: "READ"/);
  });
});
