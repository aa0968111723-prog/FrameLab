import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { closeTestDb, createTestDb, q, resetDb } from "../helpers/db.ts";
import { seedProject, seedTwoTenants, thrownCode } from "../helpers/seed.ts";
import { ownCharacter, ownFrame, ownObject, ownProject, ownTimeline } from "../../src/lib/commands/ownership.ts";
import { executeTool, type CommandContext } from "../../src/lib/commands/execute.ts";

describe("ownership.ts", () => {
  before(async () => {
    await createTestDb();
    await resetDb();
  });
  after(async () => {
    await closeTestDb();
  });

  it("happy: ownProject/ownTimeline/ownFrame return the owned rows", async () => {
    const a = await seedProject("own_happy");
    const p = await ownProject(a.ctx, a.projectId);
    assert.equal(p.id, a.projectId);
    const t = await ownTimeline(a.ctx, a.timelineId);
    assert.equal(t.id, a.timelineId);
    const f = await ownFrame(a.ctx, a.frames[0]!.id);
    assert.equal(f.id, a.frames[0]!.id);
    const n = await q<{ n: number }>("select count(*)::int as n from projects where id = $1", [a.projectId]);
    assert.equal(n[0]?.n, 1);
  });

  it("happy: ownCharacter and ownObject after create", async () => {
    const a = await seedProject("own_co");
    const ch = await executeTool(a.ctx as CommandContext, "create_character", {
      projectId: a.projectId,
      name: "主角",
    });
    const ob = await executeTool(a.ctx as CommandContext, "create_object", {
      projectId: a.projectId,
      name: "道具",
    });
    assert.equal(ch.ok, true);
    assert.equal(ob.ok, true);
    const characterId = (ch as { data: { id: string } }).data.id;
    const objectId = (ob as { data: { id: string } }).data.id;
    const c = await ownCharacter(a.ctx, characterId);
    const o = await ownObject(a.ctx, objectId);
    assert.equal(c.id, characterId);
    assert.equal(o.id, objectId);
  });

  it("ownership: stranger cannot ownProject", async () => {
    const { a, b } = await seedTwoTenants();
    assert.equal(await thrownCode(() => ownProject(a.ctx, b.projectId)), "PROJECT_NOT_FOUND");
  });

  it("ownership: stranger cannot ownTimeline", async () => {
    const { a, b } = await seedTwoTenants();
    assert.equal(await thrownCode(() => ownTimeline(a.ctx, b.timelineId)), "PROJECT_NOT_FOUND");
  });

  it("ownership: stranger cannot ownFrame", async () => {
    const { a, b } = await seedTwoTenants();
    assert.equal(await thrownCode(() => ownFrame(a.ctx, b.frames[0]!.id)), "PROJECT_NOT_FOUND");
  });

  it("ownership: stranger cannot ownCharacter or ownObject", async () => {
    const { a, b } = await seedTwoTenants();
    const ch = await executeTool(b.ctx as CommandContext, "create_character", {
      projectId: b.projectId,
      name: "secret",
    });
    const ob = await executeTool(b.ctx as CommandContext, "create_object", {
      projectId: b.projectId,
      name: "secret-obj",
    });
    const characterId = (ch as { data: { id: string } }).data.id;
    const objectId = (ob as { data: { id: string } }).data.id;
    assert.equal(await thrownCode(() => ownCharacter(a.ctx, characterId)), "PROJECT_NOT_FOUND");
    assert.equal(await thrownCode(() => ownObject(a.ctx, objectId)), "PROJECT_NOT_FOUND");
  });

  it("scope: token scoped to project A cannot ownProject B of the same user", async () => {
    const a = await seedProject("own_scope");
    const extra = await executeTool(a.ctx as CommandContext, "create_project", { name: "B" });
    const projectB = (extra as { data: { id: string } }).data.id;
    const scoped = { ...a.ctx, projectScope: a.projectId };
    assert.equal(await thrownCode(() => ownProject(scoped, projectB)), "PERMISSION_DENIED");
  });

  it("boundary: empty projectId is PROJECT_NOT_FOUND", async () => {
    const a = await seedProject("own_empty");
    assert.equal(await thrownCode(() => ownProject(a.ctx, "")), "PROJECT_NOT_FOUND");
  });

  it("boundary: missing timeline/frame/character/object ids are FRAME_NOT_FOUND", async () => {
    const a = await seedProject("own_miss");
    assert.equal(await thrownCode(() => ownTimeline(a.ctx, "tl_nope")), "FRAME_NOT_FOUND");
    assert.equal(await thrownCode(() => ownFrame(a.ctx, "frm_nope")), "FRAME_NOT_FOUND");
    assert.equal(await thrownCode(() => ownCharacter(a.ctx, "chr_nope")), "FRAME_NOT_FOUND");
    assert.equal(await thrownCode(() => ownObject(a.ctx, "obj_nope")), "FRAME_NOT_FOUND");
  });
});
