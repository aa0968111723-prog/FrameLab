import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { isAskToolAllowed } from "../src/lib/domain/conversation.ts";

const tools = readFileSync(new URL("../src/lib/commands/context-tools.ts", import.meta.url), "utf8");
const catalog = readFileSync(new URL("../src/lib/mcp/catalog.ts", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/components/workstation/conversation-panel.tsx", import.meta.url), "utf8");
const studio = readFileSync(new URL("../src/components/workstation/studio-app.tsx", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../src/lib/mcp/context-bridge.ts", import.meta.url), "utf8");

const CONTEXT_TOOLS = [
  "get_current_context",
  "get_current_frame",
  "get_selected_frames",
  "get_selected_frame_range",
  "get_selected_range",
  "get_selected_region",
  "get_current_character",
  "get_current_object",
  "get_frame_neighbors",
  "analyze_selection",
  "analyze_motion_context",
];

describe("MCP Context Bridge (spec §22–24, §29–30)", () => {
  it("named spec files exist", () => {
    const files = [
      "src/lib/domain/context-engine.ts",
      "src/lib/application/conversation-context.ts",
      "src/lib/application/vision-assets.ts",
      "src/lib/mcp/context-bridge.ts",
      "src/lib/mcp/tools/context-tools.ts",
      "src/components/workstation/conversation-panel.tsx",
      "src/components/workstation/region-selector.tsx",
      "src/components/workstation/context-inspector.tsx",
      "docs/CONTEXT_ENGINE.md",
      "docs/CONVERSATION_LAYER.md",
      "docs/MCP_CONTEXT.md",
    ];
    for (const f of files) {
      assert.ok(existsSync(new URL(`../${f}`, import.meta.url)), f);
    }
  });

  it("get_current_context returns the spec fields", () => {
    for (const field of [
      "project_id",
      "timeline_id",
      "current_frame",
      "selected_range",
      "selected_frames",
      "selected_region",
      "selected_character",
      "onion_skin",
      "overlay",
      "analysis_available",
      "conversation_id",
      "context_version",
    ]) {
      assert.ok(tools.includes(`${field}:`), field);
    }
  });

  it("lists every context-bridge tool", () => {
    assert.match(bridge, /export const McpContextBridge/);
    for (const t of CONTEXT_TOOLS) {
      assert.ok(catalog.includes(`"${t}"`) || catalog.includes(`tool("${t}"`), t);
      assert.ok(bridge.includes(t), t);
    }
  });

  it("ASK mode cannot call edit/generate", () => {
    assert.equal(isAskToolAllowed("get_current_context"), true);
    assert.equal(isAskToolAllowed("get_frame_neighbors"), true);
    assert.equal(isAskToolAllowed("analyze_selection"), true);
    assert.equal(isAskToolAllowed("repair_frame"), false);
    assert.equal(isAskToolAllowed("generate_inbetweens"), false);
    assert.equal(isAskToolAllowed("regenerate_region"), false);
    assert.equal(isAskToolAllowed("render_preview"), false);
  });

  it("overlay conversation attaches current frame / region / range", () => {
    assert.match(panel, /chipsFromSnapshot/);
    assert.match(panel, /Region selected/);
    assert.match(panel, /F\$\{snap\.current_frame\}/);
    assert.match(studio, /chipsFromSnapshot\(effectiveSnap/);
    assert.match(studio, /regionMode/);
    assert.match(studio, /commitRegion/);
  });

  it("timeline conversation marker can reopen the thread", () => {
    assert.match(studio, /onOpenConversation/);
    assert.match(studio, /Reopen conversation on this frame/);
    assert.match(studio, /openThread/);
  });
});
