import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { closeTestDb, createTestCtx, createTestDb, q, resetDb } from "../helpers/db.ts";
import { seedProject, seedTwoTenants, thrownCode } from "../helpers/seed.ts";
import {
  analyzeMotionAssist,
  analyzePoseAssist,
  getProblemRangesCmd,
  suggestRepair,
} from "../../src/lib/commands/assist-tools.ts";
import { executeTool, type CommandContext } from "../../src/lib/commands/execute.ts";
import { FrameLabError } from "../../src/lib/domain/errors.ts";

describe("assist-tools.ts", { timeout: 120_000 }, () => {
  before(async () => {
    await createTestDb();
    await resetDb();
  });
  after(async () => {
    await closeTestDb();
  });

  it("happy: analyzeMotionAssist block-match-16 writes motion rows", async () => {
    const a = await seedProject("as_motion");
    const r = await analyzeMotionAssist(a.ctx as CommandContext, {
      timelineId: a.timelineId,
      provider: "block-match-16",
      startFrame: 0,
      endFrame: 2,
    });
    assert.equal(r.provider, "block-match-16");
    const n = await q<{ n: number }>(
      "select count(*)::int as n from motion_data where timeline_id = $1",
      [a.timelineId],
    );
    assert.ok((n[0]?.n ?? 0) >= 1, "expected motion_data rows");
    const providers = await q<{ provider: string }>(
      "select distinct provider from motion_data where timeline_id = $1",
      [a.timelineId],
    );
    assert.ok(providers.every((row) => row.provider === "block-match-16"));
  });

  it("happy: analyzePoseAssist pose-lite writes pose rows", async () => {
    const a = await seedProject("as_pose");
    const r = await analyzePoseAssist(a.ctx as CommandContext, {
      timelineId: a.timelineId,
      provider: "framelab-pose-lite",
    });
    assert.equal(r.provider, "framelab-pose-lite");
    const n = await q<{ n: number }>(
      `select count(*)::int as n from poses p
       join frames f on f.id = p.frame_id
       where f.timeline_id = $1`,
      [a.timelineId],
    );
    assert.ok((n[0]?.n ?? 0) >= 1);
  });

  it("happy: suggestRepair skipJob writes problem_ranges", async () => {
    const a = await seedProject("as_sug");
    const r = await suggestRepair(a.ctx as CommandContext, {
      timelineId: a.timelineId,
      skipJob: true,
    });
    assert.ok(r);
    const listed = await getProblemRangesCmd(a.ctx as CommandContext, { timelineId: a.timelineId });
    assert.ok(listed);
    const n = await q<{ n: number }>(
      "select count(*)::int as n from problem_ranges where timeline_id = $1",
      [a.timelineId],
    );
    assert.equal(n[0]?.n, listed.ranges.length, "problem_ranges row count must match command");
  });

  it("ownership: cannot analyze another tenant's timeline", async () => {
    const { a, b } = await seedTwoTenants();
    assert.equal(
      await thrownCode(() =>
        analyzeMotionAssist(a.ctx as CommandContext, {
          timelineId: b.timelineId,
          provider: "block-match-16",
        }),
      ),
      "PROJECT_NOT_FOUND",
    );
  });

  it("scope: READ cannot analyze_motion", async () => {
    const a = await seedProject("as_scope");
    const ctx = createTestCtx({ userId: a.ctx.userId, scopes: ["READ"], clientId: "cli_as_scope" });
    const r = await executeTool(ctx as CommandContext, "analyze_motion", {
      timelineId: a.timelineId,
      provider: "block-match-16",
    });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "PERMISSION_DENIED");
  });

  it("boundary: empty timelineId is VALIDATION_ERROR", async () => {
    const a = await seedProject("as_empty");
    assert.equal(
      await thrownCode(() => analyzePoseAssist(a.ctx as CommandContext, { timelineId: "" })),
      "VALIDATION_ERROR",
    );
  });

  it("boundary: missing timeline is FRAME_NOT_FOUND", async () => {
    const a = await seedProject("as_miss");
    assert.equal(
      await thrownCode(() =>
        analyzeMotionAssist(a.ctx as CommandContext, {
          timelineId: "tl_nope",
          provider: "block-match-16",
        }),
      ),
      "FRAME_NOT_FOUND",
    );
  });

  it("boundary: default provider is sea-raft; never silent block-match-16", async () => {
    const a = await seedProject("as_raft");
    try {
      const r = await analyzeMotionAssist(a.ctx as CommandContext, { timelineId: a.timelineId });
      assert.equal(r.provider, "sea-raft", "default must be SEA-RAFT, not a silent CPU fallback");
      const rows = await q<{ provider: string }>(
        "select distinct provider from motion_data where timeline_id = $1",
        [a.timelineId],
      );
      assert.ok(rows.length >= 1, "SEA-RAFT success must persist motion_data");
      assert.ok(
        rows.every((row) => row.provider === "sea-raft"),
        `got providers ${rows.map((row) => row.provider).join(",")}`,
      );
    } catch (err) {
      if (!(err instanceof FrameLabError)) throw err;
      assert.equal(err.code, "MODEL_NOT_AVAILABLE");
      const rows = await q<{ n: number }>(
        "select count(*)::int as n from motion_data where timeline_id = $1",
        [a.timelineId],
      );
      assert.equal(rows[0]?.n, 0, "unavailable SEA-RAFT must not write fallback rows");
    }
  });
});
