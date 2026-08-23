import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { closeTestDb, createTestCtx, createTestDb, q, resetDb } from "../helpers/db.ts";
import { seedProject, seedTwoTenants, thrownCode } from "../helpers/seed.ts";
import {
  createInbetweenPlanCmd,
  createKeyframePairCmd,
  generateInbetweensCmd,
  setFrameExposureCmd,
} from "../../src/lib/commands/inbetween-tools.ts";
import { executeTool, type CommandContext } from "../../src/lib/commands/execute.ts";

describe("inbetween-tools.ts", () => {
  before(async () => {
    await createTestDb();
    await resetDb();
  });
  after(async () => {
    await closeTestDb();
  });

  it("happy: createKeyframePairCmd inserts a pair row", async () => {
    const a = await seedProject("ib_pair");
    await executeTool(a.ctx as CommandContext, "create_keyframe", {
      timelineId: a.timelineId,
      frameNumber: 0,
    });
    await executeTool(a.ctx as CommandContext, "create_keyframe", {
      timelineId: a.timelineId,
      frameNumber: 2,
    });
    const pair = await createKeyframePairCmd(a.ctx as CommandContext, {
      timelineId: a.timelineId,
      startFrame: 0,
      endFrame: 2,
      count: 1,
    });
    const rows = await q<{ id: string }>("select id from keyframe_pairs where id = $1", [pair.id]);
    assert.equal(rows.length, 1);
  });

  it("happy: plan + linear-blend generate writes a candidate, not the timeline", async () => {
    const a = await seedProject("ib_gen");
    await executeTool(a.ctx as CommandContext, "create_keyframe", {
      timelineId: a.timelineId,
      frameNumber: 0,
    });
    await executeTool(a.ctx as CommandContext, "create_keyframe", {
      timelineId: a.timelineId,
      frameNumber: 2,
    });
    const plan = await createInbetweenPlanCmd(a.ctx as CommandContext, {
      timelineId: a.timelineId,
      startFrame: 0,
      endFrame: 2,
      count: 1,
      provider: "linear-blend",
    });
    assert.ok(plan.pair?.id);
    const gen = await generateInbetweensCmd(a.ctx as CommandContext, {
      timelineId: a.timelineId,
      startFrame: 0,
      endFrame: 2,
      count: 1,
      provider: "linear-blend",
      confirmed: true,
      force: true,
    });
    assert.ok(gen.candidateId);
    const cand = await q<{ provider: string }>(
      "select provider from candidate_versions where id = $1",
      [gen.candidateId],
    );
    assert.equal(cand[0]?.provider, "linear-blend");
    const mid = await q<{ frame_type: string }>(
      "select frame_type from frames where timeline_id = $1 and frame_number = 1",
      [a.timelineId],
    );
    assert.notEqual(mid[0]?.frame_type, "GENERATED");
  });

  it("happy: setFrameExposureCmd updates exposure_count", async () => {
    const a = await seedProject("ib_exp");
    await setFrameExposureCmd(a.ctx as CommandContext, { frameId: a.frames[1]!.id, exposure: 2 });
    const row = await q<{ exposure_count: number }>(
      "select exposure_count from frames where id = $1",
      [a.frames[1]!.id],
    );
    assert.equal(row[0]?.exposure_count, 2);
  });

  it("ownership: cannot pair another tenant's timeline", async () => {
    const { a, b } = await seedTwoTenants();
    assert.equal(
      await thrownCode(() =>
        createKeyframePairCmd(a.ctx as CommandContext, {
          timelineId: b.timelineId,
          startFrame: 0,
          endFrame: 2,
        }),
      ),
      "PROJECT_NOT_FOUND",
    );
  });

  it("scope: READ cannot generate_inbetweens", async () => {
    const a = await seedProject("ib_scope");
    const ctx = createTestCtx({ userId: a.ctx.userId, scopes: ["READ"], clientId: "cli_ib_scope" });
    const r = await executeTool(ctx as CommandContext, "generate_inbetweens", {
      timelineId: a.timelineId,
      startFrame: 0,
      endFrame: 2,
      confirmed: true,
    });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "PERMISSION_DENIED");
  });

  it("boundary: empty timelineId is VALIDATION_ERROR", async () => {
    const a = await seedProject("ib_empty");
    assert.equal(
      await thrownCode(() => createKeyframePairCmd(a.ctx as CommandContext, { timelineId: "" })),
      "VALIDATION_ERROR",
    );
  });

  it("boundary: generate without confirmed is PERMISSION_DENIED", async () => {
    const a = await seedProject("ib_conf");
    const r = await executeTool(a.ctx as CommandContext, "generate_inbetweens", {
      timelineId: a.timelineId,
      startFrame: 0,
      endFrame: 2,
      provider: "linear-blend",
    });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "PERMISSION_DENIED");
  });

  it("boundary: missing frame id for exposure is FRAME_NOT_FOUND", async () => {
    const a = await seedProject("ib_miss");
    assert.equal(
      await thrownCode(() => setFrameExposureCmd(a.ctx as CommandContext, { frameId: "frm_nope" })),
      "FRAME_NOT_FOUND",
    );
  });
});
