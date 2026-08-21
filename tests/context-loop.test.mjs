import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const studio = readFileSync(new URL("../src/components/workstation/studio-app.tsx", import.meta.url), "utf8");
const catalog = readFileSync(new URL("../src/lib/mcp/catalog.ts", import.meta.url), "utf8");
const tools = readFileSync(new URL("../src/lib/commands/context-tools.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../migrations/0006_conversation.sql", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../src/lib/conversation/runtime.ts", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/components/workstation/conversation-panel.tsx", import.meta.url), "utf8");
const inspector = readFileSync(new URL("../src/components/workstation/context-inspector.tsx", import.meta.url), "utf8");
const region = readFileSync(new URL("../src/components/workstation/region-selector.tsx", import.meta.url), "utf8");

describe("V0.1 core loop wiring", () => {
  it("timeline select / canvas region / ask panel share context", () => {
    assert.match(studio, /sendAskFn/);
    assert.match(studio, /syncWorkspaceSessionFn/);
    assert.match(studio, /regionMode/);
    assert.match(studio, /commitRegion/);
    assert.match(studio, /ConversationPanel/);
    assert.match(studio, /conversationCounts/);
    assert.match(studio, /ContextInspector/);
    assert.match(studio, /RegionSelectorStatus/);
    assert.match(studio, /onOpenConversation/);
    assert.match(studio, /AI 對話/);
    assert.match(inspector, /上下文檢視/);
    assert.match(region, /selectedRegion|region\.x\.toFixed|清除選取/);
    assert.match(region, /清除選取/);
    assert.match(panel, /跟隨工作區/);
    assert.match(panel, /這則回覆對應的是較早的選取/);
    assert.match(panel, /ASK/);
    assert.match(panel, /尚未設定 AI 供應商/);
    assert.match(studio, /fl-cnv:/);
    assert.match(studio, /fl-ses:/);
    assert.match(studio, /💬/);
    assert.match(studio, /conversation survives|fl-cnv:|sessionStorage.setItem\(`fl-cnv/);
    assert.match(studio, /前 3/);
    assert.match(studio, /viewport: \{ zoom:/);
    assert.match(studio, /重開此影格的對話/);
    assert.match(studio, /regionLive/);
    assert.match(studio, /selectedCharacterId/);
    assert.match(studio, /contextLocked/);
    assert.match(studio, /setFrozenContext/);
    assert.match(tools, /thumbnailRef/);
    assert.match(tools, /Workspace session not found/);
  });

  it("MCP context tools + resources + ask prompt exist", () => {
    for (const t of [
      "get_current_context",
      "get_current_frame",
      "get_selected_frames",
      "get_selected_frame_range",
      "get_selected_region",
      "get_current_character",
      "get_current_object",
      "get_frame_neighbors",
      "analyze_selection",
      "analyze_motion_context",
    ]) {
      assert.ok(catalog.includes(`"${t}"`) || catalog.includes(`tool("${t}"`), t);
    }
    assert.match(catalog, /framelab:\/\/sessions\/\{session_id\}\/context/);
    assert.match(catalog, /framelab:\/\/session\/\{session_id\}\/context/);
    assert.match(catalog, /framelab:\/\/conversations\/\{conversation_id\}/);
    assert.match(catalog, /ask_about_selection/);
    assert.match(tools, /Workspace session not found/);
    assert.match(tools, /FRAME_NOT_FOUND/);
    assert.match(tools, /lightweight visual analysis/);
    assert.match(tools, /conversation_id:/);
    assert.match(tools, /analysis_available:/);
    assert.match(tools, /project_id:/);
  });

  it("conversation tables exist", () => {
    for (const table of [
      "workspace_sessions",
      "conversations",
      "conversation_messages",
      "conversation_tool_calls",
      "context_snapshots",
      "region_selections",
    ]) {
      assert.ok(schema.includes(table), table);
    }
    assert.match(schema, /context_version/);
  });

  it("conversation runtime never fakes MCP or Grok", () => {
    assert.doesNotMatch(runtime, /Math\.random\(\)/);
    assert.match(runtime, /executeTool/);
    assert.match(runtime, /isAskToolAllowed/);
    assert.doesNotMatch(runtime, /getFrameByNumber/);
    assert.match(runtime, /buildFallbackAskReply/);
  });
});
