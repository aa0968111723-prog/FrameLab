import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { closeTestDb, createTestCtx, createTestDb, q, resetDb } from "../helpers/db.ts";
import { seedProject, seedTwoTenants, thrownCode } from "../helpers/seed.ts";
import { repairRegionCmd } from "../../src/lib/commands/region-repair-tools.ts";
import { executeTool, type CommandContext } from "../../src/lib/commands/execute.ts";

describe("region-repair-tools.ts", () => {
  before(async () => {
    await createTestDb();
    await resetDb();
  });
  after(async () => {
    await closeTestDb();
  });

  it("happy: neighborhood preview writes a candidate without claiming AI", async () => {
    const a = await seedProject("rr_prev");
    const r = await repairRegionCmd(a.ctx as CommandContext, {
      timelineId: a.timelineId,
      frameNumber: 1,
      x: 0.1,
      y: 0.1,
      w: 0.4,
      h: 0.4,
      method: "neighborhood-preview",
    });
    assert.ok(r);
    assert.equal((r as { ai?: boolean }).ai, false);
    const n = await q<{ n: number }>(
      "select count(*)::int as n from candidate_versions where timeline_id = $1",
      [a.timelineId],
    );
    assert.ok((n[0]?.n ?? 0) >= 1);
  });

  it("honest unavailable: generative wan without provider is PROVIDER_NOT_AVAILABLE", async () => {
    const a = await seedProject("rr_wan");
    assert.equal(
      await thrownCode(() =>
        repairRegionCmd(a.ctx as CommandContext, {
          timelineId: a.timelineId,
          frameNumber: 1,
          x: 0.1,
          y: 0.1,
          w: 0.4,
          h: 0.4,
          method: "generative",
          provider: "wan",
        }),
      ),
      "PROVIDER_NOT_AVAILABLE",
    );
  });

  it("ownership: cannot repair another tenant's frame", async () => {
    const { a, b } = await seedTwoTenants();
    assert.equal(
      await thrownCode(() =>
        repairRegionCmd(a.ctx as CommandContext, {
          frameId: b.frames[1]!.id,
          x: 0.1,
          y: 0.1,
          w: 0.3,
          h: 0.3,
          method: "neighborhood-preview",
        }),
      ),
      "PROJECT_NOT_FOUND",
    );
  });

  it("scope: READ cannot regenerate_region", async () => {
    const a = await seedProject("rr_scope");
    const ctx = createTestCtx({ userId: a.ctx.userId, scopes: ["READ"], clientId: "cli_rr_scope" });
    const r = await executeTool(ctx as CommandContext, "regenerate_region", {
      timelineId: a.timelineId,
      frameNumber: 1,
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.2,
    });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "PERMISSION_DENIED");
  });

  it("boundary: missing selection is VALIDATION_ERROR", async () => {
    const a = await seedProject("rr_sel");
    assert.equal(
      await thrownCode(() =>
        repairRegionCmd(a.ctx as CommandContext, { timelineId: a.timelineId, frameNumber: 1 }),
      ),
      "VALIDATION_ERROR",
    );
  });

  it("boundary: missing frame is FRAME_NOT_FOUND", async () => {
    const a = await seedProject("rr_miss");
    assert.equal(
      await thrownCode(() =>
        repairRegionCmd(a.ctx as CommandContext, {
          timelineId: a.timelineId,
          frameNumber: 99,
          x: 0.1,
          y: 0.1,
          w: 0.2,
          h: 0.2,
        }),
      ),
      "FRAME_NOT_FOUND",
    );
  });

  it("boundary: empty ids is VALIDATION_ERROR", async () => {
    const a = await seedProject("rr_empty");
    assert.equal(await thrownCode(() => repairRegionCmd(a.ctx as CommandContext, {})), "VALIDATION_ERROR");
  });
});
