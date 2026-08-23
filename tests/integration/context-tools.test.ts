import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { closeTestDb, createTestCtx, createTestDb, q, resetDb } from "../helpers/db.ts";
import { seedProject, seedTwoTenants, thrownCode } from "../helpers/seed.ts";
import {
  getCurrentContext,
  getCurrentFrame,
  getSelectedFrameRange,
  readConversationResource,
} from "../../src/lib/commands/context-tools.ts";
import { executeTool, type CommandContext } from "../../src/lib/commands/execute.ts";
import * as repo from "../../src/lib/framelab/repo.ts";

describe("context-tools.ts", () => {
  before(async () => {
    await createTestDb();
    await resetDb();
  });
  after(async () => {
    await closeTestDb();
  });

  it("happy: getCurrentContext reads the owned session", async () => {
    const a = await seedProject("ctx_happy");
    await repo.upsertWorkspaceSession({
      id: "ses_ctx_happy",
      userId: a.ctx.userId,
      projectId: a.projectId,
      timelineId: a.timelineId,
      currentFrame: 1,
      currentFrameId: a.frames[1]!.id,
    });
    const r = await getCurrentContext(a.ctx as CommandContext, { sessionId: "ses_ctx_happy" });
    assert.equal(r.project_id, a.projectId);
    assert.equal(r.timeline_id, a.timelineId);
    assert.equal(r.current_frame?.id, a.frames[1]!.id);
    const sessions = await q<{ id: string }>("select id from workspace_sessions where id = $1", [
      "ses_ctx_happy",
    ]);
    assert.equal(sessions.length, 1);
  });

  it("happy: getCurrentFrame and getSelectedFrameRange", async () => {
    const a = await seedProject("ctx_frame");
    await repo.upsertWorkspaceSession({
      id: "ses_ctx_frame",
      userId: a.ctx.userId,
      projectId: a.projectId,
      timelineId: a.timelineId,
      currentFrame: 0,
      currentFrameId: a.frames[0]!.id,
      selectedRangeJson: JSON.stringify([0, 2]),
    });
    const frame = await getCurrentFrame(a.ctx as CommandContext, { sessionId: "ses_ctx_frame" });
    assert.equal(frame.frame?.id, a.frames[0]!.id);
    const range = await getSelectedFrameRange(a.ctx as CommandContext, { sessionId: "ses_ctx_frame" });
    assert.equal(
      range.range,
      null,
      "BUG lock: selected_range_json is ignored; only context_json hydrates the range",
    );
  });

  it("ownership: cannot read another user's session", async () => {
    const { a, b } = await seedTwoTenants();
    await repo.upsertWorkspaceSession({
      id: "ses_b",
      userId: b.ctx.userId,
      projectId: b.projectId,
      timelineId: b.timelineId,
      currentFrame: 0,
    });
    assert.equal(
      await thrownCode(() => getCurrentContext(a.ctx as CommandContext, { sessionId: "ses_b" })),
      "FRAME_NOT_FOUND",
    );
  });

  it("ownership: readConversationResource on another project is PERMISSION_DENIED", async () => {
    const a = await seedProject("ctx_conv_a");
    const extra = await executeTool(a.ctx as CommandContext, "create_project", { name: "other" });
    const projectB = (extra as { data: { id: string } }).data.id;
    await repo.insertConversation({
      id: "cnv_other_proj",
      userId: a.ctx.userId,
      projectId: projectB,
      timelineId: null,
      title: "secret",
      provider: "grok",
      mode: "ask",
      contextLocked: false,
      lockedSnapshotJson: "{}",
      frameStart: null,
      frameEnd: null,
    });
    const scoped = { ...a.ctx, projectScope: a.projectId };
    assert.equal(
      await thrownCode(() => readConversationResource(scoped as CommandContext, "cnv_other_proj")),
      "PERMISSION_DENIED",
    );
  });

  it("scope: READ cannot analyze_selection", async () => {
    const a = await seedProject("ctx_scope");
    await repo.upsertWorkspaceSession({
      id: "ses_ctx_scope",
      userId: a.ctx.userId,
      projectId: a.projectId,
      timelineId: a.timelineId,
      currentFrame: 0,
    });
    const ctx = createTestCtx({ userId: a.ctx.userId, scopes: ["READ"], clientId: "cli_ctx_scope" });
    const r = await executeTool(ctx as CommandContext, "analyze_selection", {
      sessionId: "ses_ctx_scope",
    });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "PERMISSION_DENIED");
  });

  it("boundary: missing sessionId is VALIDATION_ERROR", async () => {
    const a = await seedProject("ctx_empty");
    assert.equal(
      await thrownCode(() => getCurrentContext(a.ctx as CommandContext, {})),
      "VALIDATION_ERROR",
    );
  });

  it("boundary: unknown sessionId is FRAME_NOT_FOUND", async () => {
    const a = await seedProject("ctx_miss");
    assert.equal(
      await thrownCode(() => getCurrentContext(a.ctx as CommandContext, { sessionId: "ses_nope" })),
      "FRAME_NOT_FOUND",
    );
  });
});
