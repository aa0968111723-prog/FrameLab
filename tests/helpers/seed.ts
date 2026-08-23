/** Shared SQL fixtures for command integration tests. */
import { executeTool, type CommandContext } from "../../src/lib/commands/execute.ts";
import { encodeJpegBase64 } from "../../src/lib/domain/image-codec.ts";
import { FrameLabError } from "../../src/lib/domain/errors.ts";
import * as repo from "../../src/lib/framelab/repo.ts";
import { createTestCtx, type TestCtx } from "./db.ts";

export function jpeg(r: number, g: number, b: number): string {
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

export async function thrownCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "OK";
  } catch (err) {
    if (err instanceof FrameLabError) return err.code;
    throw err;
  }
}

export type SeededProject = {
  ctx: TestCtx;
  projectId: string;
  timelineId: string;
  frames: Array<{ id: string; frame_number: number }>;
};

export async function seedProject(userId: string): Promise<SeededProject> {
  const ctx = createTestCtx({ userId, clientId: `cli_${userId}` });
  const created = await executeTool(ctx as CommandContext, "create_project", {
    name: `proj-${userId}`,
    fps: 24,
  });
  if (!created.ok) throw new Error(`create_project: ${JSON.stringify(created)}`);
  const projectId = (created.data as { id: string }).id;
  const timelineId = (created.data as { timelineId: string }).timelineId;
  const ingested = await executeTool(ctx as CommandContext, "ingest_frames", {
    projectId,
    fps: 24,
    frames: [
      { imageData: jpeg(200, 20, 20), frameNumber: 0 },
      { imageData: jpeg(20, 200, 20), frameNumber: 1 },
      { imageData: jpeg(20, 20, 200), frameNumber: 2 },
    ],
  });
  if (!ingested.ok) throw new Error(`ingest_frames: ${JSON.stringify(ingested)}`);
  const frames = await repo.listFramesMeta(timelineId);
  return { ctx, projectId, timelineId, frames };
}

export async function seedTwoTenants() {
  const a = await seedProject("user_a");
  const b = await seedProject("user_b");
  return { a, b };
}
