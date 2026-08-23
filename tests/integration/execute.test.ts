import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { closeTestDb, createTestCtx, createTestDb, q, resetDb } from "../helpers/db.ts";
import { jpeg, seedProject, seedTwoTenants } from "../helpers/seed.ts";
import {
  createBlankProject,
  createTimelineCmd,
  executeTool,
  ingestFrames,
  type CommandContext,
} from "../../src/lib/commands/execute.ts";

describe("execute.ts", () => {
  before(async () => {
    await createTestDb();
    await resetDb();
  });
  after(async () => {
    await closeTestDb();
  });

  it("happy: createBlankProject writes project + timeline rows", async () => {
    const ctx = createTestCtx({ userId: "exec_happy", clientId: "cli_exec_happy" });
    const created = await createBlankProject(ctx as CommandContext, { name: "空白專案", fps: 24 });
    const projects = await q<{ name: string; user_id: string }>(
      "select name, user_id from projects where id = $1",
      [created.id],
    );
    assert.equal(projects.length, 1);
    assert.equal(projects[0]?.name, "空白專案");
    assert.equal(projects[0]?.user_id, "exec_happy");
    const tls = await q<{ id: string }>("select id from timelines where project_id = $1", [created.id]);
    assert.equal(tls.length, 1);
    assert.equal(tls[0]?.id, created.timelineId);
  });

  it("happy: ingestFrames writes three frame rows", async () => {
    const ctx = createTestCtx({ userId: "exec_ingest", clientId: "cli_exec_ingest" });
    const r = await ingestFrames(ctx as CommandContext, {
      name: "seq",
      fps: 24,
      frames: [
        { imageData: jpeg(9, 9, 9), frameNumber: 0 },
        { imageData: jpeg(8, 8, 8), frameNumber: 1 },
        { imageData: jpeg(7, 7, 7), frameNumber: 2 },
      ],
    });
    const n = await q<{ n: number }>(
      "select count(*)::int as n from frames where timeline_id = $1",
      [r.timelineId],
    );
    assert.equal(n[0]?.n, 3);
  });

  it("happy: createTimelineCmd inserts a second timeline", async () => {
    const seeded = await seedProject("exec_tl");
    const extra = await createTimelineCmd(seeded.ctx as CommandContext, {
      projectId: seeded.projectId,
      name: "副軸",
    });
    const rows = await q<{ name: string }>(
      "select name from timelines where project_id = $1 order by created_at",
      [seeded.projectId],
    );
    assert.equal(rows.length, 2);
    assert.ok(rows.some((r) => r.name === "副軸"));
    assert.equal(typeof extra.id, "string");
  });

  it("ownership: get_project with another tenant's id is PROJECT_NOT_FOUND", async () => {
    const { a, b } = await seedTwoTenants();
    const r = await executeTool(a.ctx as CommandContext, "get_project", { projectId: b.projectId });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "PROJECT_NOT_FOUND");
  });

  it("ownership: ingest_frames cannot wipe another tenant's project", async () => {
    const { a, b } = await seedTwoTenants();
    const r = await executeTool(a.ctx as CommandContext, "ingest_frames", {
      projectId: b.projectId,
      fps: 24,
      frames: [{ imageData: jpeg(1, 1, 1), frameNumber: 0 }],
    });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "PROJECT_NOT_FOUND");
    const n = await q<{ n: number }>(
      "select count(*)::int as n from frames f join timelines t on t.id = f.timeline_id where t.project_id = $1",
      [b.projectId],
    );
    assert.equal(n[0]?.n, 3);
  });

  it("scope: READ ctx cannot create_project", async () => {
    const ctx = createTestCtx({ userId: "exec_read", scopes: ["READ"], clientId: "cli_exec_read" });
    const r = await executeTool(ctx as CommandContext, "create_project", { name: "nope" });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "PERMISSION_DENIED");
  });

  it("scope: READ ctx cannot ingest_frames", async () => {
    const seeded = await seedProject("exec_read2");
    const ctx = createTestCtx({ userId: seeded.ctx.userId, scopes: ["READ"], clientId: "cli_exec_read2" });
    const r = await executeTool(ctx as CommandContext, "ingest_frames", {
      projectId: seeded.projectId,
      fps: 24,
      frames: [],
    });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "PERMISSION_DENIED");
  });

  it("boundary: unknown tool is MCP_TOOL_ERROR", async () => {
    const ctx = createTestCtx({ userId: "exec_unk", clientId: "cli_exec_unk" });
    const r = await executeTool(ctx as CommandContext, "not_a_real_tool", {});
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "MCP_TOOL_ERROR");
  });

  it("boundary: get_frame with missing id is FRAME_NOT_FOUND", async () => {
    const seeded = await seedProject("exec_miss");
    const r = await executeTool(seeded.ctx as CommandContext, "get_frame", { frameId: "frm_missing" });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "FRAME_NOT_FOUND");
  });

  it("boundary: get_timeline with empty id is FRAME_NOT_FOUND", async () => {
    const seeded = await seedProject("exec_empty");
    const r = await executeTool(seeded.ctx as CommandContext, "get_timeline", { timelineId: "" });
    assert.equal(r.ok, false);
    assert.match((r as { code: string }).code, /FRAME_NOT_FOUND|VALIDATION_ERROR/);
  });

  it("boundary: create_timeline without projectId is PROJECT_NOT_FOUND", async () => {
    const seeded = await seedProject("exec_notl");
    const r = await executeTool(seeded.ctx as CommandContext, "create_timeline", {});
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "PROJECT_NOT_FOUND");
  });
});
