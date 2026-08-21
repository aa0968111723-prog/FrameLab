import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  clampExtractNumbers,
  extractFramesWithFfmpeg,
  ffmpegExtractArgs,
} from "../src/lib/media/ffmpeg.ts";

const ROOT = path.join(process.cwd(), "data", "test-ingest-scale");

function runFfmpeg(args) {
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`ffmpeg failed (${r.status}): ${r.stderr?.slice(0, 500)}`);
  }
}

function makeVideo(file, frames) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  runFfmpeg([
    "-hide_banner",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=32x24:rate=12",
    "-frames:v",
    String(frames),
    "-pix_fmt",
    "yuv420p",
    "-c:v",
    "mpeg4",
    "-q:v",
    "8",
    file,
  ]);
}

async function extractCount(label, frames) {
  const dir = path.join(ROOT, label);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const input = path.join(dir, "clip.mp4");
  const outDir = path.join(dir, "frames");
  makeVideo(input, frames);
  const extracted = await extractFramesWithFfmpeg({
    inputPath: input,
    outputDir: outDir,
    fps: 12,
    maxWidth: 32,
    maxFrames: 0,
  });
  return extracted.files.length;
}

after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("video ingest scale", () => {
  it("does not ship demo 72 / 160 frame caps", () => {
    const files = [
      "src/lib/media/ffmpeg.ts",
      "src/lib/extract-frames.ts",
      "src/lib/framelab/api.ts",
      "src/lib/commands/execute.ts",
      "src/components/workstation/project-home.tsx",
    ];
    for (const f of files) {
      const src = fs.readFileSync(path.join(process.cwd(), f), "utf8");
      assert.doesNotMatch(src, /maxFrames:\s*72/);
      assert.doesNotMatch(src, /Cap is 160/);
      assert.doesNotMatch(src, /slice\(0,\s*160\)/);
      assert.doesNotMatch(src, /Math\.min\(160/);
      assert.doesNotMatch(src, /最多 72/);
      assert.doesNotMatch(src, /maxFrames:\s*160/);
    }
    const exec = fs.readFileSync(path.join(process.cwd(), "src/lib/commands/execute.ts"), "utf8");
    assert.doesNotMatch(exec, /readJpegFilesAsBase64/);
    assert.match(exec, /readJpegFileAsBase64/);
    assert.match(exec, /startJob/);
    const api = fs.readFileSync(path.join(process.cwd(), "src/lib/framelab/api.ts"), "utf8");
    assert.match(api, /每批最多 32 格/);
  });

  it("clamp honors thousands and treats 0 as unlimited", () => {
    const c = clampExtractNumbers(12, 640, 5000);
    assert.equal(c.maxFrames, 5000);
    assert.equal(clampExtractNumbers(12, 640, 0).maxFrames, 0);
    const args = ffmpegExtractArgs({
      inputPath: "/workspace/data/p/source/a.mp4",
      outputDir: "/workspace/data/p/frames",
      fps: 12,
      maxWidth: 32,
      maxFrames: 0,
    });
    assert.equal(args.includes("-frames:v"), false);
    assert.ok(args.some((a) => a.endsWith("frame_%06d.jpg")));
  });

  it("extracts 500 frames with no demo cap", { timeout: 120_000 }, async () => {
    const n = await extractCount("f500", 500);
    assert.ok(n >= 500, `expected >= 500 frames, got ${n}`);
    assert.ok(n <= 502, `unexpected extra frames: ${n}`);
  });

  it("extracts 1000 frames with no demo cap", { timeout: 180_000 }, async () => {
    const n = await extractCount("f1000", 1000);
    assert.ok(n >= 1000, `expected >= 1000 frames, got ${n}`);
    assert.ok(n <= 1002, `unexpected extra frames: ${n}`);
  });
});
