import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { closeTestDb, createTestCtx, createTestDb, q, resetDb } from "../helpers/db.ts";
import { seedProject, seedTwoTenants, thrownCode } from "../helpers/seed.ts";
import { editPoseCmd, listPoseConstraintsCmd } from "../../src/lib/commands/pose-edit-tools.ts";
import { analyzePoseAssist } from "../../src/lib/commands/assist-tools.ts";
import { executeTool, type CommandContext } from "../../src/lib/commands/execute.ts";

describe("pose-edit-tools.ts", () => {
  before(async () => {
    await createTestDb();
    await resetDb();
  });
  after(async () => {
    await closeTestDb();
  });

  it("happy: editPoseCmd writes a pose_constraints row and does not change the jpeg hash", async () => {
    const a = await seedProject("pe_happy");
    await analyzePoseAssist(a.ctx as CommandContext, {
      timelineId: a.timelineId,
      provider: "framelab-pose-lite",
      startFrame: 1,
      endFrame: 1,
    });
    const before = await q<{ content_hash: string }>(
      "select content_hash from frames where id = $1",
      [a.frames[1]!.id],
    );
    const r = await editPoseCmd(a.ctx as CommandContext, {
      timelineId: a.timelineId,
      frameNumber: 1,
      joint: "right_wrist",
      x: 0.8,
      y: 0.4,
    });
    assert.ok(r);
    const cons = await q<{ joint: string }>(
      "select joint from pose_constraints where frame_id = $1",
      [a.frames[1]!.id],
    );
    assert.ok(cons.some((c) => c.joint === "right_wrist"));
    const after = await q<{ content_hash: string }>(
      "select content_hash from frames where id = $1",
      [a.frames[1]!.id],
    );
    assert.equal(after[0]?.content_hash, before[0]?.content_hash);
  });

  it("happy: listPoseConstraintsCmd returns the saved constraint", async () => {
    const a = await seedProject("pe_list");
    await analyzePoseAssist(a.ctx as CommandContext, {
      timelineId: a.timelineId,
      provider: "framelab-pose-lite",
    });
    await editPoseCmd(a.ctx as CommandContext, {
      timelineId: a.timelineId,
      frameNumber: 0,
      joint: "left_wrist",
      x: 0.2,
      y: 0.5,
    });
    const listed = await listPoseConstraintsCmd(a.ctx as CommandContext, {
      timelineId: a.timelineId,
      frameNumber: 0,
    });
    assert.ok(listed.constraints.some((c) => c.joint === "left_wrist"));
  });

  it("ownership: cannot edit another tenant's pose", async () => {
    const { a, b } = await seedTwoTenants();
    await analyzePoseAssist(b.ctx as CommandContext, {
      timelineId: b.timelineId,
      provider: "framelab-pose-lite",
    });
    assert.equal(
      await thrownCode(() =>
        editPoseCmd(a.ctx as CommandContext, {
          timelineId: b.timelineId,
          frameNumber: 1,
          joint: "right_wrist",
          x: 0.5,
          y: 0.5,
        }),
      ),
      "PROJECT_NOT_FOUND",
    );
  });

  it("scope: READ cannot edit_pose", async () => {
    const a = await seedProject("pe_scope");
    const ctx = createTestCtx({ userId: a.ctx.userId, scopes: ["READ"], clientId: "cli_pe_scope" });
    const r = await executeTool(ctx as CommandContext, "edit_pose", {
      timelineId: a.timelineId,
      frameNumber: 1,
      joint: "right_wrist",
      x: 0.5,
      y: 0.5,
    });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "PERMISSION_DENIED");
  });

  it("boundary: no pose yet is FRAME_NOT_FOUND", async () => {
    const a = await seedProject("pe_nopose");
    assert.equal(
      await thrownCode(() =>
        editPoseCmd(a.ctx as CommandContext, {
          timelineId: a.timelineId,
          frameNumber: 1,
          joint: "right_wrist",
          x: 0.5,
          y: 0.5,
        }),
      ),
      "FRAME_NOT_FOUND",
    );
  });

  it("boundary: missing joint is VALIDATION_ERROR", async () => {
    const a = await seedProject("pe_joint");
    await analyzePoseAssist(a.ctx as CommandContext, {
      timelineId: a.timelineId,
      provider: "framelab-pose-lite",
    });
    assert.equal(
      await thrownCode(() =>
        editPoseCmd(a.ctx as CommandContext, {
          timelineId: a.timelineId,
          frameNumber: 0,
          x: 0.5,
          y: 0.5,
        }),
      ),
      "VALIDATION_ERROR",
    );
  });

  it("boundary: empty timelineId is VALIDATION_ERROR or FRAME_NOT_FOUND", async () => {
    const a = await seedProject("pe_empty");
    const code = await thrownCode(() =>
      listPoseConstraintsCmd(a.ctx as CommandContext, { timelineId: "" }),
    );
    assert.match(code, /VALIDATION_ERROR|FRAME_NOT_FOUND/);
  });
});
