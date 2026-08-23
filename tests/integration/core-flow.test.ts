/**
 * End-to-end mutation path. Every assertion reads SQL rows, not just executeTool
 * return values. linear-blend is the honest CPU preview (not AI inbetween).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { closeTestDb, createTestCtx, createTestDb, q, resetDb } from "../helpers/db.ts";
import { executeTool } from "../../src/lib/commands/execute.ts";
import { encodeJpegBase64 } from "../../src/lib/domain/image-codec.ts";

function solidJpeg(r: number, g: number, b: number): string {
  const width = 16;
  const height = 16;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return encodeJpegBase64({ data, width, height });
}

describe("core mutation flow", { concurrency: false, timeout: 60_000 }, () => {
  before(async () => {
    await createTestDb();
    await resetDb();
  });

  after(async () => {
    await closeTestDb();
  });

  it("create_project → create_timeline → ingest_frames → plan → generate → accept → undo → redo", async () => {
    const ctx = createTestCtx({ userId: "user_core_flow", clientId: "cli_core_flow" });

    const created = await executeTool(ctx, "create_project", { name: "SQL 主線", fps: 24 });
    assert.equal(created.ok, true, JSON.stringify(created));
    const projectId = (created as { data: { id: string; timelineId: string } }).data.id;
    const defaultTl = (created as { data: { timelineId: string } }).data.timelineId;
    const projects = await q<{ id: string; name: string; user_id: string }>(
      "select id, name, user_id from projects where id = $1",
      [projectId],
    );
    assert.equal(projects.length, 1);
    assert.equal(projects[0]?.name, "SQL 主線");
    assert.equal(projects[0]?.user_id, ctx.userId);
    const defaultRows = await q<{ id: string }>("select id from timelines where project_id = $1", [projectId]);
    assert.equal(defaultRows.length, 1);
    assert.equal(defaultRows[0]?.id, defaultTl);

    const extra = await executeTool(ctx, "create_timeline", {
      projectId,
      name: "第二條時間軸",
      fps: 24,
    });
    assert.equal(extra.ok, true, JSON.stringify(extra));
    const extraId = (extra as { data: { id: string } }).data.id;
    const timelines = await q<{ id: string; name: string }>(
      "select id, name from timelines where project_id = $1 order by created_at",
      [projectId],
    );
    assert.equal(timelines.length, 2);
    assert.ok(timelines.some((t) => t.id === extraId && t.name === "第二條時間軸"));

    const red = solidJpeg(220, 20, 20);
    const mid = solidJpeg(120, 120, 120);
    const blue = solidJpeg(20, 40, 220);
    const ingested = await executeTool(ctx, "ingest_frames", {
      projectId,
      fps: 24,
      frames: [
        { imageData: red, frameNumber: 0 },
        { imageData: mid, frameNumber: 1 },
        { imageData: blue, frameNumber: 2 },
      ],
    });
    assert.equal(ingested.ok, true, JSON.stringify(ingested));
    const frameRows = await q<{ frame_number: number; frame_type: string; content_hash: string }>(
      "select frame_number, frame_type, content_hash from frames where timeline_id = $1 order by frame_number",
      [defaultTl],
    );
    assert.equal(frameRows.length, 3);
    assert.deepEqual(
      frameRows.map((f) => f.frame_number),
      [0, 1, 2],
    );
    const beforeMidHash = frameRows[1]?.content_hash;
    assert.ok(beforeMidHash);

    const keyA = await executeTool(ctx, "create_keyframe", { timelineId: defaultTl, frameNumber: 0 });
    const keyB = await executeTool(ctx, "create_keyframe", { timelineId: defaultTl, frameNumber: 2 });
    assert.equal(keyA.ok, true, JSON.stringify(keyA));
    assert.equal(keyB.ok, true, JSON.stringify(keyB));
    const types = await q<{ frame_number: number; frame_type: string }>(
      "select frame_number, frame_type from frames where timeline_id = $1 order by frame_number",
      [defaultTl],
    );
    assert.equal(types[0]?.frame_type, "KEY");
    assert.equal(types[2]?.frame_type, "KEY");

    const plan = await executeTool(ctx, "create_inbetween_plan", {
      timelineId: defaultTl,
      startFrame: 0,
      endFrame: 2,
      count: 1,
      provider: "linear-blend",
    });
    assert.equal(plan.ok, true, JSON.stringify(plan));
    const pairs = await q<{ id: string; start_frame_number: number; end_frame_number: number }>(
      "select id, start_frame_number, end_frame_number from keyframe_pairs where timeline_id = $1",
      [defaultTl],
    );
    assert.ok(pairs.length >= 1);
    assert.equal(pairs[0]?.start_frame_number, 0);
    assert.equal(pairs[0]?.end_frame_number, 2);
    const motion = await q<{ id: string }>("select id from motion_plans where timeline_id = $1", [defaultTl]);
    assert.ok(motion.length >= 1);

    const generated = await executeTool(ctx, "generate_inbetweens", {
      timelineId: defaultTl,
      startFrame: 0,
      endFrame: 2,
      count: 1,
      provider: "linear-blend",
      confirmed: true,
      force: true,
    });
    assert.equal(generated.ok, true, JSON.stringify(generated));
    const genData = (generated as { data: { candidateId?: string; jobId?: string } }).data;
    assert.ok(genData.candidateId, JSON.stringify(generated));
    const candidates = await q<{ id: string; status: string; provider: string }>(
      "select id, status, provider from candidate_versions where id = $1",
      [genData.candidateId],
    );
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.provider, "linear-blend");
    assert.equal(candidates[0]?.status, "ready");
    const stillOriginal = await q<{ frame_type: string; content_hash: string }>(
      "select frame_type, content_hash from frames where timeline_id = $1 and frame_number = 1",
      [defaultTl],
    );
    assert.equal(stillOriginal[0]?.content_hash, beforeMidHash, "generate must not write the active timeline");

    const accepted = await executeTool(ctx, "accept_generated_frames", {
      candidateId: genData.candidateId,
      confirmed: true,
    });
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    const afterAccept = await q<{ frame_type: string; content_hash: string }>(
      "select frame_type, content_hash from frames where timeline_id = $1 and frame_number = 1",
      [defaultTl],
    );
    assert.equal(afterAccept[0]?.frame_type, "GENERATED");
    assert.notEqual(afterAccept[0]?.content_hash, beforeMidHash);
    const acceptedHash = afterAccept[0]?.content_hash;
    const revisions = await q<{ id: string; action: string; status: string }>(
      "select id, action, status from revisions where project_id = $1 order by created_at desc",
      [projectId],
    );
    assert.ok(revisions.some((r) => r.action === "accept_generated_frames" && r.status === "open"));

    const undone = await executeTool(ctx, "undo", { projectId });
    assert.equal(undone.ok, true, JSON.stringify(undone));
    const afterUndo = await q<{ frame_type: string; content_hash: string }>(
      "select frame_type, content_hash from frames where timeline_id = $1 and frame_number = 1",
      [defaultTl],
    );
    assert.equal(afterUndo[0]?.content_hash, beforeMidHash);
    assert.notEqual(afterUndo[0]?.frame_type, "GENERATED");
    const undoneRev = await q<{ status: string }>(
      "select status from revisions where project_id = $1 and action = 'accept_generated_frames' order by created_at desc limit 1",
      [projectId],
    );
    assert.equal(undoneRev[0]?.status, "reverted");

    const redone = await executeTool(ctx, "redo", { projectId });
    assert.equal(redone.ok, true, JSON.stringify(redone));
    const afterRedo = await q<{ frame_type: string; content_hash: string }>(
      "select frame_type, content_hash from frames where timeline_id = $1 and frame_number = 1",
      [defaultTl],
    );
    assert.equal(afterRedo[0]?.frame_type, "GENERATED");
    assert.equal(afterRedo[0]?.content_hash, acceptedHash);
  });
});
