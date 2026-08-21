import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { blankJpegBase64, blankRgba, decodeJpegBase64 } from "../src/lib/domain/image-codec.ts";
import { isTimelineEdit, TIMELINE_OPS } from "../src/lib/domain/timeline-ops.ts";
import { MCP_TOOLS } from "../src/lib/mcp/catalog.ts";
import { TOOL_SCOPES } from "../src/lib/domain/permissions.ts";

describe("blank frame jpeg", () => {
  it("encodes paper-sized jpeg", () => {
    const b64 = blankJpegBase64(32, 18);
    const rgba = decodeJpegBase64(b64);
    assert.equal(rgba.width, 32);
    assert.equal(rgba.height, 18);
    assert.ok(rgba.data[0] > 200);
    assert.ok(rgba.data[3] === 255);
  });
  it("blank rgba fills the buffer", () => {
    const r = blankRgba(2, 2, [10, 20, 30]);
    assert.equal(r.data.length, 16);
    assert.equal(r.data[0], 10);
    assert.equal(r.data[1], 20);
    assert.equal(r.data[2], 30);
  });
});

describe("timeline edit contract", () => {
  it("recognizes the ops including create_breakdown", () => {
    assert.deepEqual([...TIMELINE_OPS], [
      "add_frame",
      "insert_frame",
      "duplicate_frame",
      "delete_frame",
      "clear_frame",
      "hold_frame",
      "create_breakdown",
    ]);
    for (const op of TIMELINE_OPS) {
      assert.equal(isTimelineEdit({ op, timelineId: "tl" }), true);
      assert.ok(TOOL_SCOPES[op], op);
      assert.ok(MCP_TOOLS.some((t) => t.name === op), op);
    }
    assert.equal(isTimelineEdit({ timelineId: "tl" }), false);
    assert.equal(isTimelineEdit(null), false);
  });

  it("commands write revisions and restore by op", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/commands/timeline-edit.ts"), "utf8");
    const exec = fs.readFileSync(path.join(process.cwd(), "src/lib/commands/execute.ts"), "utf8");
    assert.match(src, /insertRevision/);
    assert.match(src, /applyTimelineEdit/);
    assert.match(src, /direction === "undo"/);
    assert.match(exec, /isTimelineEdit\(prev\)/);
    assert.match(exec, /applyTimelineEdit\(ctx, prev, "undo"\)/);
    assert.match(exec, /applyTimelineEdit\(ctx, next, "redo"\)/);
  });

  it("timeline chrome exposes the six actions", () => {
    const tl = fs.readFileSync(path.join(process.cwd(), "src/components/workstation/visual-timeline.tsx"), "utf8");
    const studio = fs.readFileSync(path.join(process.cwd(), "src/components/workstation/studio-app.tsx"), "utf8");
    for (const label of ["新增", "插入", "複製", "停格", "清空", "刪除"]) {
      assert.match(tl, new RegExp(label));
    }
    for (const tool of TIMELINE_OPS) {
      assert.match(studio, new RegExp(tool));
    }
  });
});
