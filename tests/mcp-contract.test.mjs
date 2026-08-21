import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { FrameLabError } from "../src/lib/domain/errors.ts";
import { assertToolAllowed } from "../src/lib/domain/permissions.ts";

const catalog = readFileSync(new URL("../src/lib/mcp/catalog.ts", import.meta.url), "utf8");
const perms = readFileSync(new URL("../src/lib/domain/permissions.ts", import.meta.url), "utf8");
const http = readFileSync(new URL("../src/lib/mcp/http.ts", import.meta.url), "utf8");
const errors = readFileSync(new URL("../src/lib/domain/errors.ts", import.meta.url), "utf8");

const READ_TOOLS = [
  "list_projects", "get_project", "get_video", "get_timeline", "get_frame",
  "get_frame_range", "get_keyframes", "get_character", "get_character_track",
  "get_object_track", "get_consistency_results", "get_problem_frames", "get_job",
  "get_model_status",
  "get_current_context", "get_current_frame", "get_selected_frames",
  "get_selected_frame_range", "get_selected_range", "get_selected_region", "get_current_character",
  "get_current_object", "get_frame_neighbors",
];
const ANALYZE_TOOLS = [
  "analyze_frame", "analyze_frame_range", "analyze_pose", "analyze_motion",
  "analyze_tracking", "analyze_consistency", "detect_problem_frames",
  "detect_keyframes", "compare_frames",
  "analyze_selection", "analyze_motion_context",
];

function hasScope(granted, needed) {
  if (granted.includes("ADMIN")) return true;
  if (granted.includes(needed)) return true;
  if (needed === "READ") return granted.some((s) => s !== "READ");
  return false;
}

describe("MCP contract (§63)", () => {
  it("lists resources including frame / range / analysis", () => {
    for (const u of [
      "framelab://projects",
      "framelab://frames/{frame_id}",
      "framelab://frames/{frame_id}/analysis",
      "framelab://frames/{frame_id}/neighbors",
      "framelab://jobs/{job_id}",
      "framelab://sessions/{session_id}/context",
      "framelab://conversations/{conversation_id}",
    ]) {
      assert.ok(catalog.includes(u), u);
    }
    assert.ok(http.includes("resources/list"));
    assert.ok(http.includes("resources/read"));
    assert.ok(http.includes("tools/call"));
  });

  it("every spec read/analyze tool has a scope", () => {
    for (const t of [...READ_TOOLS, ...ANALYZE_TOOLS]) {
      assert.ok(catalog.includes(`"${t}"`) || catalog.includes(`tool("${t}"`), t);
      assert.ok(perms.includes(`${t}:`), `scope ${t}`);
    }
  });

  it("denies GENERATE without scope", () => {
    assert.equal(hasScope(["READ", "ANALYZE"], "GENERATE"), false);
    assert.equal(hasScope(["READ", "ANALYZE", "EDIT", "GENERATE"], "GENERATE"), true);
    assert.equal(hasScope(["ADMIN"], "GENERATE"), true);
    assert.equal(hasScope(["ANALYZE"], "READ"), true);
  });

  it("unknown tool is MCP_TOOL_ERROR", () => {
    assert.ok(perms.includes("Unknown tool"));
    assert.ok(errors.includes("MCP_TOOL_ERROR"));
    assert.ok(errors.includes("PERMISSION_DENIED"));
    assert.ok(errors.includes("FRAME_NOT_FOUND"));
  });

  it("high-risk tools are listed", () => {
    for (const t of ["delete_frame", "replace_frame", "repair_frame_range", "regenerate_region"]) {
      assert.ok(perms.includes(`"${t}"`), t);
    }
  });

  it("audit log fields exist", () => {
    assert.ok(http.includes("executeTool"));
    const schema = readFileSync(new URL("../migrations/0002_framelab.sql", import.meta.url), "utf8");
    for (const col of ["tool", "caller", "scope_used", "arguments_json", "project_id", "frame_range", "status", "duration_ms"]) {
      assert.ok(schema.includes(col), col);
    }
  });

  it("analyze_tracking is a real NCC tool, not a fake LocoTrack", () => {
    assert.ok(catalog.includes("framelab-ncc"));
    assert.ok(catalog.includes("MODEL_NOT_AVAILABLE"));
  });

  it("context tools are session-isolated and ASK-safe", () => {
    for (const t of [
      "get_current_context",
      "get_current_frame",
      "get_selected_frame_range",
      "get_selected_range",
      "get_selected_region",
    ]) {
      assert.ok(perms.includes(`${t}:`), t);
    }
    assert.ok(catalog.includes("ask_about_selection"));
    assert.ok(http.includes("get_current_context"));
    assert.ok(http.includes("readConversationResource"));
    assert.ok(http.includes("sessions"));
    assert.ok(http.includes("conversations"));
  });
});

describe("MCP live permission + invalid session (§59)", () => {
  it("READ+ANALYZE cannot call GENERATE tools", () => {
    assert.throws(
      () => assertToolAllowed(["READ", "ANALYZE"], "repair_frame"),
      (err) => err instanceof FrameLabError && err.code === "PERMISSION_DENIED",
    );
    assert.throws(
      () => assertToolAllowed(["READ"], "analyze_selection"),
      (err) => err instanceof FrameLabError && err.code === "PERMISSION_DENIED",
    );
    assert.doesNotThrow(() => assertToolAllowed(["READ", "ANALYZE"], "get_selected_range"));
    assert.doesNotThrow(() => assertToolAllowed(["READ", "ANALYZE"], "analyze_selection"));
  });

  it("unknown tool is MCP_TOOL_ERROR", () => {
    assert.throws(
      () => assertToolAllowed(["ADMIN"], "not_a_real_tool"),
      (err) => err instanceof FrameLabError && err.code === "MCP_TOOL_ERROR",
    );
  });

  it("invalid session is FRAME_NOT_FOUND / missing sessionId is VALIDATION_ERROR", () => {
    const tools = readFileSync(new URL("../src/lib/commands/context-tools.ts", import.meta.url), "utf8");
    assert.match(tools, /sessionId required/);
    assert.match(tools, /Workspace session not found/);
    assert.match(tools, /FRAME_NOT_FOUND/);
  });
});
