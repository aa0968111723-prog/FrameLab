import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { closeTestDb, createTestCtx, createTestDb, q, resetDb } from "../helpers/db.ts";
import { seedProject, seedTwoTenants, thrownCode } from "../helpers/seed.ts";
import { editMotionPathCmd, listMotionConstraintsCmd } from "../../src/lib/commands/motion-path-tools.ts";
import { executeTool, type CommandContext } from "../../src/lib/commands/execute.ts";

describe("motion-path-tools.ts", () => {
  before(async () => {
    await createTestDb();
    await resetDb();
  });
  after(async () => {
    await closeTestDb();
  });

  it("happy: editMotionPathCmd writes tracking_points + motion_constraints, not pixels", async () => {
    const a = await seedProject("mp_happy");
    const before = await q<{ content_hash: string }>(
      "select content_hash from frames where id = $1",
      [a.frames[1]!.id],
    );
    const r = await editMotionPathCmd(a.ctx as CommandContext, {
      timelineId: a.timelineId,
      frameNumber: 1,
      name: "right_hand",
      x: 0.7,
      y: 0.3,
    });
    assert.ok(r);
    const pts = await q<{ name: string }>(
      "select name from tracking_points where project_id = $1 and name = 'right_hand'",
      [a.projectId],
    );
    assert.equal(pts.length, 1);
    const cons = await q<{ name: string }>(
      "select name from motion_constraints where project_id = $1",
      [a.projectId],
    );
    assert.ok(cons.length >= 1);
    const after = await q<{ content_hash: string }>(
      "select content_hash from frames where id = $1",
      [a.frames[1]!.id],
    );
    assert.equal(after[0]?.content_hash, before[0]?.content_hash);
  });

  it("happy: listMotionConstraintsCmd returns the constraint", async () => {
    const a = await seedProject("mp_list");
    await editMotionPathCmd(a.ctx as CommandContext, {
      timelineId: a.timelineId,
      frameNumber: 0,
      name: "trail",
      x: 0.2,
      y: 0.2,
    });
    const listed = await listMotionConstraintsCmd(a.ctx as CommandContext, {
      projectId: a.projectId,
      name: "trail",
    });
    assert.ok(listed.constraints.some((c) => c.name === "trail"));
  });

  it("ownership: cannot edit another tenant's path", async () => {
    const { a, b } = await seedTwoTenants();
    assert.equal(
      await thrownCode(() =>
        editMotionPathCmd(a.ctx as CommandContext, {
          timelineId: b.timelineId,
          frameNumber: 1,
          name: "right_hand",
          x: 0.5,
          y: 0.5,
        }),
      ),
      "PROJECT_NOT_FOUND",
    );
  });

  it("scope: READ cannot edit_motion_path", async () => {
    const a = await seedProject("mp_scope");
    const ctx = createTestCtx({ userId: a.ctx.userId, scopes: ["READ"], clientId: "cli_mp_scope" });
    const r = await executeTool(ctx as CommandContext, "edit_motion_path", {
      timelineId: a.timelineId,
      frameNumber: 1,
      name: "right_hand",
      x: 0.5,
      y: 0.5,
    });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "PERMISSION_DENIED");
  });

  it("boundary: missing name is VALIDATION_ERROR", async () => {
    const a = await seedProject("mp_name");
    assert.equal(
      await thrownCode(() =>
        editMotionPathCmd(a.ctx as CommandContext, {
          timelineId: a.timelineId,
          frameNumber: 1,
          x: 0.5,
          y: 0.5,
        }),
      ),
      "VALIDATION_ERROR",
    );
  });

  it("boundary: missing frameNumber is VALIDATION_ERROR", async () => {
    const a = await seedProject("mp_fn");
    assert.equal(
      await thrownCode(() =>
        editMotionPathCmd(a.ctx as CommandContext, {
          timelineId: a.timelineId,
          name: "trail",
          x: 0.5,
          y: 0.5,
        }),
      ),
      "VALIDATION_ERROR",
    );
  });

  it("boundary: empty projectId for list is VALIDATION_ERROR", async () => {
    const a = await seedProject("mp_empty");
    assert.equal(
      await thrownCode(() => listMotionConstraintsCmd(a.ctx as CommandContext, {})),
      "VALIDATION_ERROR",
    );
  });
});
