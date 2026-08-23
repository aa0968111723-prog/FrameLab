import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { closeTestDb, createTestCtx, createTestDb, q, resetDb } from "../helpers/db.ts";
import { seedProject, seedTwoTenants, thrownCode } from "../helpers/seed.ts";
import { listSegmentationsCmd, segmentObjectCmd } from "../../src/lib/commands/sam2-tools.ts";
import { executeTool, type CommandContext } from "../../src/lib/commands/execute.ts";
import { FrameLabError } from "../../src/lib/domain/errors.ts";

async function maskCount(timelineId: string): Promise<number> {
  const n = await q<{ n: number }>(
    `select count(*)::int as n
     from segmentations s
     join frames f on f.id = s.frame_id
     where f.timeline_id = $1`,
    [timelineId],
  );
  return n[0]?.n ?? 0;
}

describe("sam2-tools.ts", { timeout: 120_000 }, () => {
  before(async () => {
    await createTestDb();
    await resetDb();
  });
  after(async () => {
    await closeTestDb();
  });

  it("happy: listSegmentationsCmd returns empty masks when none stored", async () => {
    const a = await seedProject("sam_list");
    const r = await listSegmentationsCmd(a.ctx as CommandContext, { timelineId: a.timelineId });
    assert.deepEqual(r.masks, []);
    assert.equal(await maskCount(a.timelineId), 0);
  });

  it("honest unavailable: segmentObjectCmd does not insert a fake mask", async () => {
    const a = await seedProject("sam_unavail");
    let failed = false;
    try {
      const r = await segmentObjectCmd(a.ctx as CommandContext, {
        timelineId: a.timelineId,
        frameNumber: 1,
        x: 0.5,
        y: 0.5,
      });
      assert.ok(r);
      assert.ok((await maskCount(a.timelineId)) >= 1, "success must persist real SAM 2 masks");
      const providers = await q<{ provider: string }>(
        `select distinct s.provider
         from segmentations s
         join frames f on f.id = s.frame_id
         where f.timeline_id = $1`,
        [a.timelineId],
      );
      assert.ok(providers.every((row) => row.provider === "sam2"));
    } catch (err) {
      failed = true;
      if (err instanceof FrameLabError) {
        assert.match(err.code, /MODEL_NOT_AVAILABLE|JOB_FAILED|FRAME_ASSET_UNAVAILABLE/);
      } else {
        // BUG lock: worker failure is a generic Error, not FrameLabError.
        assert.ok(err instanceof Error, `unexpected throw: ${String(err)}`);
        assert.match(
          err.message,
          /SAM 2|empty mask|not loaded|failed/i,
          `unexpected error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (failed) {
      assert.equal(await maskCount(a.timelineId), 0, "must not insert a fake mask");
    }
  });

  it("ownership: cannot list another tenant's segmentations", async () => {
    const { a, b } = await seedTwoTenants();
    assert.equal(
      await thrownCode(() =>
        listSegmentationsCmd(a.ctx as CommandContext, { timelineId: b.timelineId }),
      ),
      "PROJECT_NOT_FOUND",
    );
  });

  it("ownership: cannot segment another tenant's timeline", async () => {
    const { a, b } = await seedTwoTenants();
    assert.equal(
      await thrownCode(() =>
        segmentObjectCmd(a.ctx as CommandContext, {
          timelineId: b.timelineId,
          frameNumber: 1,
          x: 0.5,
          y: 0.5,
        }),
      ),
      "PROJECT_NOT_FOUND",
    );
  });

  it("scope: READ cannot segment_object", async () => {
    const a = await seedProject("sam_scope");
    const ctx = createTestCtx({ userId: a.ctx.userId, scopes: ["READ"], clientId: "cli_sam_scope" });
    const r = await executeTool(ctx as CommandContext, "segment_object", {
      timelineId: a.timelineId,
      frameNumber: 1,
      x: 0.5,
      y: 0.5,
    });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "PERMISSION_DENIED");
  });

  it("boundary: missing x/y is VALIDATION_ERROR after availability, or MODEL_NOT_AVAILABLE first", async () => {
    const a = await seedProject("sam_xy");
    const code = await thrownCode(() =>
      segmentObjectCmd(a.ctx as CommandContext, { timelineId: a.timelineId, frameNumber: 1 }),
    );
    assert.match(code, /VALIDATION_ERROR|MODEL_NOT_AVAILABLE/);
  });

  it("boundary: empty timelineId is VALIDATION_ERROR or FRAME_NOT_FOUND", async () => {
    const a = await seedProject("sam_empty");
    const code = await thrownCode(() => listSegmentationsCmd(a.ctx as CommandContext, { timelineId: "" }));
    assert.match(code, /VALIDATION_ERROR|FRAME_NOT_FOUND/);
  });

  it("boundary: missing timeline is FRAME_NOT_FOUND", async () => {
    const a = await seedProject("sam_miss");
    assert.equal(
      await thrownCode(() => listSegmentationsCmd(a.ctx as CommandContext, { timelineId: "tl_nope" })),
      "FRAME_NOT_FOUND",
    );
  });
});
