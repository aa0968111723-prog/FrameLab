import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  interiorFrames,
  isBreakdownMode,
  isBreakdownSetType,
  resolveBreakdownTarget,
  resolveCopySource,
  suggestBreakdownPositions,
} from "../src/lib/domain/breakdown.ts";
import { FrameLabError } from "../src/lib/domain/errors.ts";
import { isAskToolAllowed, isAssistToolAllowed } from "../src/lib/domain/conversation.ts";
import { TOOL_SCOPES } from "../src/lib/domain/permissions.ts";
import { MCP_TOOLS } from "../src/lib/mcp/catalog.ts";
import { mapRestPath } from "../src/lib/framelab/rest-map.ts";
import { TIMELINE_OPS } from "../src/lib/domain/timeline-ops.ts";

describe("breakdown positions", () => {
  it("midpoint between keys, never auto", () => {
    const s = suggestBreakdownPositions({ start: 100, end: 110 });
    assert.equal(s.auto, false);
    assert.deepEqual(s.frames, [105]);
    assert.equal(s.needs_insert, false);
    assert.match(s.reason, /不會自動建立/);
  });

  it("high complexity suggests thirds as well", () => {
    const s = suggestBreakdownPositions({
      start: 100,
      end: 110,
      complexity: "VERY_HIGH",
      occlusion: true,
      contact_count: 1,
      pose_displacement: 0.9,
    });
    assert.ok(s.frames.includes(105));
    assert.ok(s.frames.length >= 2);
    assert.equal(s.auto, false);
    assert.ok(interiorFrames(100, 110).includes(s.frames[0]!));
  });

  it("adjacent keys need insert, no auto frame numbers", () => {
    const s = suggestBreakdownPositions({ start: 5, end: 6 });
    assert.deepEqual(s.frames, []);
    assert.equal(s.needs_insert, true);
    const t = resolveBreakdownTarget({ start: 5, end: 6 });
    assert.equal(t.insert, true);
    assert.equal(t.target, 6);
  });

  it("rejects a breakdown on a key", () => {
    assert.throws(
      () => resolveBreakdownTarget({ start: 10, end: 20, requested: 10 }),
      (err) => err instanceof FrameLabError && err.code === "INVALID_KEYFRAME_PAIR",
    );
  });

  it("copy source is A or B", () => {
    assert.equal(resolveCopySource(10, 20, "start"), 10);
    assert.equal(resolveCopySource(10, 20, "end"), 20);
    assert.equal(resolveCopySource(10, 20, 14), 14);
  });
});

describe("breakdown command contract", () => {
  it("create_breakdown is EDIT, not generative, and not an ASK/ASSIST write", () => {
    assert.equal(TOOL_SCOPES.create_breakdown, "EDIT");
    assert.equal(isAskToolAllowed("create_breakdown"), false);
    assert.equal(isAssistToolAllowed("create_breakdown"), false);
    assert.equal(isAssistToolAllowed("suggest_breakdown_frames"), true);
    assert.ok(MCP_TOOLS.some((t) => t.name === "create_breakdown"));
    assert.ok(TIMELINE_OPS.includes("create_breakdown"));
    assert.equal(isBreakdownMode("blank"), true);
    assert.equal(isBreakdownMode("copy"), true);
    assert.equal(isBreakdownSetType("BREAKDOWN"), true);
    assert.equal(isBreakdownSetType("GENERATED_BREAKDOWN"), false);
    assert.equal(mapRestPath("POST", "/api/v1/breakdowns", {})?.tool, "create_breakdown");
    assert.equal(mapRestPath("POST", "/api/v1/breakdowns/suggest", {})?.tool, "suggest_breakdown_frames");
  });

  it("command refuses generative breakdown and writes a revision", () => {
    const src = readFileSync(new URL("../src/lib/commands/timeline-edit.ts", import.meta.url), "utf8");
    assert.match(src, /export async function createBreakdownCmd/);
    assert.match(src, /GENERATED_BREAKDOWN/);
    assert.match(src, /mode === "blank"/);
    assert.match(src, /mode === "copy"/);
    assert.match(src, /op: "create_breakdown"/);
    assert.match(src, /insertRevision|record\(/);
    assert.doesNotMatch(src, /generateBreakdownFrameCmd/);
    assert.doesNotMatch(src, /getInbetween\("rife"\)/);
  });

  it("panel: blank / copy / type / suggest; no AI inbetween label", () => {
    const panel = readFileSync(new URL("../src/components/workstation/inbetween-panel.tsx", import.meta.url), "utf8");
    const studio = readFileSync(new URL("../src/components/workstation/studio-app.tsx", import.meta.url), "utf8");
    assert.match(panel, /空白分解/);
    assert.match(panel, /複製 A 修改/);
    assert.match(panel, /複製 B 修改/);
    assert.match(panel, /建議位置/);
    assert.match(panel, /影格類型/);
    assert.match(panel, /不是生成式分解/);
    assert.match(studio, /tool: "create_breakdown"/);
    assert.match(studio, /tool: "suggest_breakdown_frames"/);
    assert.match(studio, /tool: "set_frame_type"/);
    assert.doesNotMatch(studio, /generate_breakdown_frame/);
    assert.doesNotMatch(panel, /generate_breakdown_frame/);
  });
});
