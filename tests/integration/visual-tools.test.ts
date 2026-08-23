import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { closeTestDb, createTestCtx, createTestDb, q, resetDb } from "../helpers/db.ts";
import { seedProject, seedTwoTenants, thrownCode } from "../helpers/seed.ts";
import {
  annotateFrameCmd,
  highlightFrameRangeCmd,
  highlightRegionCmd,
  listVisualAnnotationsCmd,
} from "../../src/lib/commands/visual-tools.ts";
import { executeTool, type CommandContext } from "../../src/lib/commands/execute.ts";
import * as repo from "../../src/lib/framelab/repo.ts";

describe("visual-tools.ts", () => {
  before(async () => {
    await createTestDb();
    await resetDb();
  });
  after(async () => {
    await closeTestDb();
  });

  it("happy: annotateFrameCmd with sessionId writes a row", async () => {
    const a = await seedProject("vis_ann");
    await repo.upsertWorkspaceSession({
      id: "ses_vis_ann",
      userId: a.ctx.userId,
      projectId: a.projectId,
      timelineId: a.timelineId,
    });
    const r = await annotateFrameCmd(a.ctx as CommandContext, {
      sessionId: "ses_vis_ann",
      frameNumber: 1,
      label: "標記",
      x: 0.2,
      y: 0.2,
    });
    assert.ok(r.annotation?.id);
    const rows = await q<{ label: string; project_id: string }>(
      "select label, project_id from visual_annotations where session_id = $1",
      ["ses_vis_ann"],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.label, "標記");
    assert.equal(rows[0]?.project_id, a.projectId);
  });

  it("happy: highlightRegion and highlightFrameRange persist", async () => {
    const a = await seedProject("vis_hl");
    await repo.upsertWorkspaceSession({
      id: "ses_vis_hl",
      userId: a.ctx.userId,
      projectId: a.projectId,
    });
    await highlightRegionCmd(a.ctx as CommandContext, {
      sessionId: "ses_vis_hl",
      frameNumber: 0,
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.2,
    });
    await highlightFrameRangeCmd(a.ctx as CommandContext, {
      sessionId: "ses_vis_hl",
      startFrame: 0,
      endFrame: 2,
    });
    const n = await q<{ n: number }>(
      "select count(*)::int as n from visual_annotations where session_id = $1",
      ["ses_vis_hl"],
    );
    assert.equal(n[0]?.n, 2);
  });

  it("ownership: cannot annotate with another user's session", async () => {
    const { a, b } = await seedTwoTenants();
    await repo.upsertWorkspaceSession({
      id: "ses_vis_b",
      userId: b.ctx.userId,
      projectId: b.projectId,
    });
    assert.equal(
      await thrownCode(() =>
        annotateFrameCmd(a.ctx as CommandContext, { sessionId: "ses_vis_b", frameNumber: 0 }),
      ),
      "FRAME_NOT_FOUND",
    );
  });

  it("ownership: cannot annotate another tenant's projectId", async () => {
    const { a, b } = await seedTwoTenants();
    assert.equal(
      await thrownCode(() =>
        highlightRegionCmd(a.ctx as CommandContext, { projectId: b.projectId, frameNumber: 0 }),
      ),
      "PROJECT_NOT_FOUND",
    );
  });

  it("scope: READ cannot annotate_frame", async () => {
    const a = await seedProject("vis_scope");
    const ctx = createTestCtx({ userId: a.ctx.userId, scopes: ["READ"], clientId: "cli_vis_scope" });
    const r = await executeTool(ctx as CommandContext, "annotate_frame", {
      projectId: a.projectId,
      frameNumber: 0,
    });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "PERMISSION_DENIED");
  });

  it("boundary: missing projectId/sessionId/timelineId is VALIDATION_ERROR", async () => {
    const a = await seedProject("vis_empty");
    assert.equal(
      await thrownCode(() => annotateFrameCmd(a.ctx as CommandContext, { frameNumber: 0 })),
      "VALIDATION_ERROR",
    );
  });

  it("boundary: listVisualAnnotationsCmd for a missing session returns empty", async () => {
    const a = await seedProject("vis_list");
    const rows = await listVisualAnnotationsCmd(a.ctx as CommandContext, { sessionId: "ses_none" });
    assert.ok(Array.isArray(rows));
    assert.equal(rows.length, 0);
  });
});
