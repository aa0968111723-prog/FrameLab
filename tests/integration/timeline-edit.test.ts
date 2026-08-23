import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { closeTestDb, createTestCtx, createTestDb, q, resetDb } from "../helpers/db.ts";
import { seedProject, seedTwoTenants, thrownCode } from "../helpers/seed.ts";
import {
  addFrameCmd,
  clearFrameCmd,
  createBreakdownCmd,
  deleteFrameCmd,
  duplicateFrameCmd,
  holdFrameCmd,
  insertFrameCmd,
} from "../../src/lib/commands/timeline-edit.ts";
import { executeTool, type CommandContext } from "../../src/lib/commands/execute.ts";

describe("timeline-edit.ts", () => {
  before(async () => {
    await createTestDb();
    await resetDb();
  });
  after(async () => {
    await closeTestDb();
  });

  it("happy: addFrameCmd inserts a row and a revision", async () => {
    const a = await seedProject("tl_add");
    const r = await addFrameCmd(a.ctx as CommandContext, { timelineId: a.timelineId });
    const n = await q<{ n: number }>(
      "select count(*)::int as n from frames where timeline_id = $1",
      [a.timelineId],
    );
    assert.equal(n[0]?.n, 4);
    const revs = await q<{ action: string }>(
      "select action from revisions where project_id = $1 and action = 'add_frame'",
      [a.projectId],
    );
    assert.ok(revs.length >= 1);
    assert.equal(typeof r.id, "string");
  });

  it("happy: duplicate/insert/hold/clear/delete persist", async () => {
    const a = await seedProject("tl_ops");
    const dup = await duplicateFrameCmd(a.ctx as CommandContext, { frameId: a.frames[0]!.id });
    const ins = await insertFrameCmd(a.ctx as CommandContext, {
      timelineId: a.timelineId,
      frameNumber: 1,
    });
    const hold = await holdFrameCmd(a.ctx as CommandContext, { frameId: a.frames[1]!.id, exposure: 2 });
    const clr = await clearFrameCmd(a.ctx as CommandContext, { frameId: a.frames[2]!.id });
    assert.ok(dup.id && ins.id && hold.id && clr.id);
    const held = await q<{ frame_type: string; exposure_count: number }>(
      "select frame_type, exposure_count from frames where id = $1",
      [a.frames[1]!.id],
    );
    assert.equal(held[0]?.frame_type, "HOLD");
    assert.equal(held[0]?.exposure_count, 2);
    const beforeDel = await q<{ n: number }>(
      "select count(*)::int as n from frames where timeline_id = $1",
      [a.timelineId],
    );
    await deleteFrameCmd(a.ctx as CommandContext, { frameId: dup.id });
    const afterDel = await q<{ n: number }>(
      "select count(*)::int as n from frames where timeline_id = $1",
      [a.timelineId],
    );
    assert.equal(afterDel[0]!.n, beforeDel[0]!.n - 1);
  });

  it("happy: createBreakdownCmd marks a mid frame BREAKDOWN", async () => {
    const a = await seedProject("tl_bd");
    await executeTool(a.ctx as CommandContext, "create_keyframe", {
      timelineId: a.timelineId,
      frameNumber: 0,
    });
    await executeTool(a.ctx as CommandContext, "create_keyframe", {
      timelineId: a.timelineId,
      frameNumber: 2,
    });
    const r = await createBreakdownCmd(a.ctx as CommandContext, {
      timelineId: a.timelineId,
      startFrame: 0,
      endFrame: 2,
      mode: "blank",
      frameNumber: 1,
    });
    assert.ok(r);
    const row = await q<{ frame_type: string }>(
      "select frame_type from frames where timeline_id = $1 and frame_number = 1",
      [a.timelineId],
    );
    assert.equal(row[0]?.frame_type, "BREAKDOWN");
  });

  it("ownership: cannot add_frame on another tenant's timeline", async () => {
    const { a, b } = await seedTwoTenants();
    assert.equal(
      await thrownCode(() => addFrameCmd(a.ctx as CommandContext, { timelineId: b.timelineId })),
      "PROJECT_NOT_FOUND",
    );
    const n = await q<{ n: number }>(
      "select count(*)::int as n from frames where timeline_id = $1",
      [b.timelineId],
    );
    assert.equal(n[0]?.n, 3);
  });

  it("ownership: cannot delete another tenant's frame", async () => {
    const { a, b } = await seedTwoTenants();
    assert.equal(
      await thrownCode(() => deleteFrameCmd(a.ctx as CommandContext, { frameId: b.frames[1]!.id })),
      "PROJECT_NOT_FOUND",
    );
  });

  it("scope: READ cannot add_frame", async () => {
    const a = await seedProject("tl_scope");
    const ctx = createTestCtx({ userId: a.ctx.userId, scopes: ["READ"], clientId: "cli_tl_scope" });
    const r = await executeTool(ctx as CommandContext, "add_frame", { timelineId: a.timelineId });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "PERMISSION_DENIED");
  });

  it("boundary: delete missing frame is FRAME_NOT_FOUND", async () => {
    const a = await seedProject("tl_miss");
    assert.equal(
      await thrownCode(() => deleteFrameCmd(a.ctx as CommandContext, { frameId: "frm_nope" })),
      "FRAME_NOT_FOUND",
    );
  });

  it("boundary: addFrameCmd with empty timelineId is FRAME_NOT_FOUND", async () => {
    const a = await seedProject("tl_empty");
    assert.equal(
      await thrownCode(() => addFrameCmd(a.ctx as CommandContext, { timelineId: "" })),
      "FRAME_NOT_FOUND",
    );
  });

  it("boundary: cannot delete the last remaining frame", async () => {
    const a = await seedProject("tl_last");
    await deleteFrameCmd(a.ctx as CommandContext, { frameId: a.frames[2]!.id });
    await deleteFrameCmd(a.ctx as CommandContext, { frameId: a.frames[1]!.id });
    assert.equal(
      await thrownCode(() => deleteFrameCmd(a.ctx as CommandContext, { frameId: a.frames[0]!.id })),
      "VALIDATION_ERROR",
    );
    const n = await q<{ n: number }>(
      "select count(*)::int as n from frames where timeline_id = $1",
      [a.timelineId],
    );
    assert.equal(n[0]?.n, 1);
  });
});
