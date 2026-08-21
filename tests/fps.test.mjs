import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  DEFAULT_PLAYBACK_FPS,
  PRESET_FPS,
  clampFps,
  clampExposure,
  frameDurationMs,
  inferFpsFromCount,
  normalizeSourceFps,
  parseFfmpegVideoMeta,
  parseFpsField,
  resolveExtractFps,
  resolvePlaybackFps,
} from "../src/lib/domain/fps.ts";
import { extractFramesWithFfmpeg, ffmpegExtractArgs, probeVideoMeta } from "../src/lib/media/ffmpeg.ts";

const ROOT = path.join(process.cwd(), "data", "test-fps");

describe("fps domain", () => {
  it("never defaults the playback clock to 12", () => {
    assert.equal(DEFAULT_PLAYBACK_FPS, 24);
    assert.notEqual(DEFAULT_PLAYBACK_FPS, 12);
    assert.equal(clampFps(0), 24);
    assert.equal(clampFps(Number.NaN), 24);
    assert.equal(parseFpsField(null), "auto");
    assert.equal(parseFpsField(""), "auto");
    assert.equal(parseFpsField("auto"), "auto");
    assert.equal(parseFpsField("source"), "auto");
    assert.equal(parseFpsField("0"), "auto");
    assert.equal(normalizeSourceFps(0), 24);
    assert.equal(normalizeSourceFps(Number.NaN), 24);
  });

  it("accepts 12 / 24 / 30 / custom 1–60", () => {
    assert.deepEqual([...PRESET_FPS], [12, 24, 30]);
    assert.equal(parseFpsField(12), 12);
    assert.equal(parseFpsField("24"), 24);
    assert.equal(parseFpsField("30"), 30);
    assert.equal(parseFpsField("18"), 18);
    assert.equal(parseFpsField("99"), 60);
    assert.equal(clampFps(1), 1);
    assert.equal(clampFps(60), 60);
    assert.equal(clampFps(12, 24), 12);
  });

  it("snaps broadcast fractions onto animation integers", () => {
    assert.equal(normalizeSourceFps(23.976), 24);
    assert.equal(normalizeSourceFps(23.98), 24);
    assert.equal(normalizeSourceFps(29.97), 30);
    assert.equal(normalizeSourceFps(59.94), 60);
    assert.equal(normalizeSourceFps(24), 24);
    assert.equal(normalizeSourceFps(12), 12);
    assert.equal(normalizeSourceFps(25), 25);
    assert.equal(normalizeSourceFps(8), 8);
  });

  it("resolveExtractFps uses source when auto", () => {
    assert.equal(resolveExtractFps("auto", 30), 30);
    assert.equal(resolveExtractFps(0, 24), 24);
    assert.equal(resolveExtractFps(12, 30), 12);
    assert.equal(resolveExtractFps("24", 12), 24);
    assert.equal(resolveExtractFps("18", 30), 18);
    assert.equal(resolveExtractFps(undefined, 30), 30);
  });

  it("resolvePlaybackFps same follows extract, never a hidden 12", () => {
    assert.equal(resolvePlaybackFps("same", 30), 30);
    assert.equal(resolvePlaybackFps("auto", 24), 24);
    assert.equal(resolvePlaybackFps(undefined, 18), 18);
    assert.equal(resolvePlaybackFps(12, 24), 12);
    assert.equal(resolvePlaybackFps("30", 12), 30);
    assert.equal(resolvePlaybackFps(0, 30), 30);
    assert.equal(resolvePlaybackFps("same", 12), 12);
  });

  it("separates playback fps from drawing exposure", () => {
    assert.equal(frameDurationMs(24, 1), 42);
    assert.equal(frameDurationMs(24, 2), 84);
    assert.equal(frameDurationMs(12, 1), 83);
    assert.equal(frameDurationMs(30, 1), 33);
    assert.equal(frameDurationMs(30, 3), 99);
    assert.equal(clampExposure(0), 1);
    assert.equal(clampExposure(9), 4);
    const onesAt24 = frameDurationMs(24, 1);
    const twosAt24 = frameDurationMs(24, 2);
    assert.notEqual(onesAt24, twosAt24);
    assert.equal(twosAt24, onesAt24 * 2);
    assert.equal(frameDurationMs(30, 2), 66);
  });

  it("infers fps from native frame count × duration", () => {
    assert.equal(inferFpsFromCount(30, 1000), 30);
    assert.equal(inferFpsFromCount(24, 1000), 24);
    assert.equal(inferFpsFromCount(60, 2000), 30);
    assert.equal(inferFpsFromCount(24, 2000), 12);
    assert.equal(inferFpsFromCount(0, 1000), 0);
    assert.equal(inferFpsFromCount(30, 0), 0);
  });
});

describe("ffmpeg probe", () => {
  it("parses 23.98 fps / 29.97 fps / ratio stderr", () => {
    const film = parseFfmpegVideoMeta(
      [
        "Duration: 00:00:02.00, start: 0.000000, bitrate: 200 kb/s",
        "  Stream #0:0(und): Video: h264 (High), yuv420p, 1920x1080, 180 kb/s, 23.98 fps, 24 tbr, 24k tbn",
      ].join("\n"),
    );
    assert.equal(film.fps, 24);
    assert.equal(film.fpsFound, true);
    assert.equal(film.durationMs, 2000);
    assert.equal(film.width, 1920);
    assert.equal(film.height, 1080);

    const ntsc = parseFfmpegVideoMeta(
      "Duration: 00:01:00.06\n    Stream #0:0: Video: h264, yuv420p, 1280x720, 29.97 fps, 29.97 tbr, 30k tbn",
    );
    assert.equal(ntsc.fps, 30);
    assert.equal(ntsc.fpsFound, true);
    assert.equal(ntsc.width, 1280);

    const ratio = parseFfmpegVideoMeta(
      "Duration: 00:00:01.00\nStream #0:0: Video: h264, yuv420p, 640x360, 30000/1001 fps, 29.97 tbr",
    );
    assert.equal(ratio.fps, 30);
    assert.equal(ratio.fpsFound, true);

    const twelve = parseFfmpegVideoMeta(
      "Duration: 00:00:02.00\nStream #0:0: Video: mpeg4, yuv420p, 32x24, 12 fps, 12 tbr, 12 tbn",
    );
    assert.equal(twelve.fps, 12);
    assert.equal(twelve.fpsFound, true);

    const thirty = parseFfmpegVideoMeta(
      "Duration: 00:00:01.00\nStream #0:0: Video: h264, yuv420p, 32x24, 30 fps, 30 tbr",
    );
    assert.equal(thirty.fps, 30);

    const pal = parseFfmpegVideoMeta(
      "Duration: 00:00:01.00\nStream #0:0: Video: mpeg2video, yuv420p, 720x576, 25 fps, 25 tbr, 25 tbn",
    );
    assert.equal(pal.fps, 25);

    const tbrOnly = parseFfmpegVideoMeta(
      "Duration: 00:00:01.00\nStream #0:0: Video: h264, yuv420p, 32x24, 18 tbr, 15360 tbn",
    );
    assert.equal(tbrOnly.fps, 18);
    assert.equal(tbrOnly.fpsFound, true);
  });

  it("does not treat 30000/1001 denominator as 60fps, and missing rate is 24 not 12", () => {
    const trap = parseFfmpegVideoMeta(
      "Duration: 00:00:01.00\nStream #0:0: Video: h264, yuv420p, 640x360, 24000/1001 fps, 23.98 tbr",
    );
    assert.equal(trap.fps, 24);
    assert.notEqual(trap.fps, 60);

    const missing = parseFfmpegVideoMeta(
      "Duration: 00:00:01.00\nStream #0:0: Audio: aac, 48000 Hz, stereo",
    );
    assert.equal(missing.fps, 24);
    assert.equal(missing.fpsFound, false);
    assert.notEqual(missing.fps, 12);
  });
});

function runFfmpeg(args) {
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`ffmpeg failed (${r.status}): ${r.stderr?.slice(0, 400)}`);
  }
}

function makeVideo(file, frames, rate) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  runFfmpeg([
    "-hide_banner",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=blue:s=32x24:rate=${rate}`,
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

after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("probe real video fps", () => {
  it("reads 24fps source and auto-extracts at 24", { timeout: 60_000 }, async () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const input = path.join(ROOT, "clip24.mp4");
    const outDir = path.join(ROOT, "frames24");
    fs.rmSync(outDir, { recursive: true, force: true });
    makeVideo(input, 24, 24);
    const meta = await probeVideoMeta(input);
    assert.equal(meta.fps, 24);
    const extracted = await extractFramesWithFfmpeg({
      inputPath: input,
      outputDir: outDir,
      fps: 0,
      maxWidth: 32,
      maxFrames: 0,
    });
    assert.equal(extracted.sourceFps, 24);
    assert.ok(extracted.files.length >= 23, `got ${extracted.files.length}`);
    assert.ok(extracted.files.length <= 25, `got ${extracted.files.length}`);
  });

  it("reads 30fps source and auto keeps 30, not 12 or 24", { timeout: 60_000 }, async () => {
    const input = path.join(ROOT, "clip30.mp4");
    const outDir = path.join(ROOT, "frames30");
    fs.rmSync(outDir, { recursive: true, force: true });
    makeVideo(input, 30, 30);
    const meta = await probeVideoMeta(input);
    assert.equal(meta.fps, 30);
    const extracted = await extractFramesWithFfmpeg({
      inputPath: input,
      outputDir: outDir,
      fps: 0,
      maxWidth: 32,
      maxFrames: 0,
    });
    assert.equal(extracted.sourceFps, 30);
    assert.ok(extracted.files.length >= 29, `got ${extracted.files.length}`);
    assert.ok(extracted.files.length <= 31, `got ${extracted.files.length}`);
  });

  it("explicit 12 on a 30fps source resamples but remembers source 30", { timeout: 60_000 }, async () => {
    const input = path.join(ROOT, "clip30b.mp4");
    const outDir = path.join(ROOT, "frames30to12");
    fs.rmSync(outDir, { recursive: true, force: true });
    makeVideo(input, 30, 30);
    const extracted = await extractFramesWithFfmpeg({
      inputPath: input,
      outputDir: outDir,
      fps: 12,
      maxWidth: 32,
      maxFrames: 0,
    });
    assert.equal(extracted.sourceFps, 30);
    assert.ok(extracted.files.length >= 11, `got ${extracted.files.length}`);
    assert.ok(extracted.files.length <= 13, `got ${extracted.files.length}`);
  });

  it("custom 18 extract on 30fps source", { timeout: 60_000 }, async () => {
    const input = path.join(ROOT, "clip30c.mp4");
    const outDir = path.join(ROOT, "frames18");
    fs.rmSync(outDir, { recursive: true, force: true });
    makeVideo(input, 30, 30);
    const extracted = await extractFramesWithFfmpeg({
      inputPath: input,
      outputDir: outDir,
      fps: 18,
      maxWidth: 32,
      maxFrames: 0,
    });
    assert.equal(extracted.sourceFps, 30);
    assert.ok(extracted.files.length >= 16, `got ${extracted.files.length}`);
    assert.ok(extracted.files.length <= 20, `got ${extracted.files.length}`);
  });
});

describe("import paths do not hardcode 12fps", () => {
  it("home / api / ingest default to auto or 24", () => {
    const home = fs.readFileSync(path.join(process.cwd(), "src/components/workstation/project-home.tsx"), "utf8");
    const videos = fs.readFileSync(path.join(process.cwd(), "src/routes/api/videos.ts"), "utf8");
    const exec = fs.readFileSync(path.join(process.cwd(), "src/lib/commands/execute.ts"), "utf8");
    const extract = fs.readFileSync(path.join(process.cwd(), "src/lib/extract-frames.ts"), "utf8");
    const ffmpeg = fs.readFileSync(path.join(process.cwd(), "src/lib/media/ffmpeg.ts"), "utf8");
    const domain = fs.readFileSync(path.join(process.cwd(), "src/lib/domain/fps.ts"), "utf8");
    assert.doesNotMatch(home, /body\.set\("fps",\s*"12"\)/);
    assert.doesNotMatch(home, /fps:\s*12/);
    assert.match(home, /來源自動/);
    assert.match(home, /同拆幀/);
    assert.doesNotMatch(videos, /\|\|\s*12/);
    assert.match(videos, /parseFpsField/);
    assert.match(exec, /DEFAULT_PLAYBACK_FPS/);
    assert.doesNotMatch(exec, /num\(args\.fps,\s*12\)/);
    assert.match(exec, /set_playback_fps/);
    assert.doesNotMatch(extract, /Math\.min\(30,\s*opts\.fps\)/);
    assert.match(extract, /DEFAULT_PLAYBACK_FPS/);
    assert.doesNotMatch(extract, /:\s*12\s*;/);
    assert.match(ffmpeg, /extractFps <= 0/);
    assert.match(domain, /DEFAULT_PLAYBACK_FPS = 24/);
    const autoArgs = ffmpegExtractArgs({
      inputPath: "/workspace/data/p/source/a.mp4",
      outputDir: "/workspace/data/p/frames",
      fps: 0,
      maxWidth: 32,
      maxFrames: 0,
    });
    const vf = autoArgs[autoArgs.indexOf("-vf") + 1];
    assert.equal(vf.startsWith("fps="), false);
  });
});
