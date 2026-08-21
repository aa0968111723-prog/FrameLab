import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fail } from "../domain/errors.ts";
import {
  DEFAULT_PLAYBACK_FPS,
  inferFpsFromCount,
  parseFfmpegVideoMeta,
  type VideoProbeMeta,
} from "../domain/fps.ts";
import { assertInsideData, dataRoot, safeFilename } from "../storage/local.ts";

const ALLOWED_EXT = new Set([".mp4", ".webm", ".mov", ".mkv", ".m4v", ".avi"]);
const MAX_BYTES = 512 * 1024 * 1024;
const FRAME_FILE_PATTERN = "frame_%06d.jpg";

export type ExtractConfig = {
  inputPath: string;
  outputDir: string;
  fps: number;
  maxWidth: number;
  /** 0 / omitted = extract every fps-sampled frame (thousands). */
  maxFrames?: number;
};

export function clampExtractNumbers(fps: number, maxWidth: number, maxFrames: number) {
  // fps 0 = keep source timing (no fps= resample). Cap 60 for 60fps sources / custom.
  const f = !Number.isFinite(fps) || fps <= 0 ? 0 : Math.max(1, Math.min(60, Math.round(fps)));
  const w = Math.max(32, Math.min(640, Math.round(maxWidth) & ~1));
  const n =
    !Number.isFinite(maxFrames) || maxFrames <= 0 ? 0 : Math.max(1, Math.round(maxFrames));
  return { fps: f, maxWidth: w, maxFrames: n };
}

export function ffmpegExtractArgs(cfg: ExtractConfig): string[] {
  const { fps, maxWidth, maxFrames } = clampExtractNumbers(
    cfg.fps,
    cfg.maxWidth,
    cfg.maxFrames ?? 0,
  );
  const pattern = path.join(cfg.outputDir, FRAME_FILE_PATTERN);
  const scale = `scale=${maxWidth}:-2:flags=lanczos`;
  const vf = fps > 0 ? `fps=${fps},${scale}` : scale;
  const args = [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-loglevel",
    "error",
    "-i",
    cfg.inputPath,
    "-vf",
    vf,
    "-q:v",
    "4",
  ];
  if (maxFrames > 0) {
    args.push("-frames:v", String(maxFrames));
  }
  args.push(pattern);
  return args;
}

function run(cmd: string, args: string[]): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { shell: false });
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stderr, stdout });
    });
  });
}

export async function probeDurationMs(inputPath: string): Promise<number> {
  return (await probeVideoMeta(inputPath)).durationMs;
}

export async function probeVideoMeta(inputPath: string): Promise<VideoProbeMeta> {
  const full = assertInsideData(inputPath);
  const result = await run("ffmpeg", ["-hide_banner", "-i", full]);
  const meta = parseFfmpegVideoMeta(`${result.stderr}\n${result.stdout}`);
  if (meta.fps <= 0) {
    meta.fps = DEFAULT_PLAYBACK_FPS;
    meta.fpsFound = false;
  }
  return meta;
}

export async function extractFramesWithFfmpeg(cfg: ExtractConfig): Promise<{
  files: string[];
  durationMs: number;
  sourceFps: number;
}> {
  const input = assertInsideData(cfg.inputPath);
  const ext = path.extname(input).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) fail("VALIDATION_ERROR", `Unsupported video type ${ext}`);
  const info = await stat(input);
  if (info.size > MAX_BYTES) fail("VALIDATION_ERROR", "影片超過 512MB");
  const outDir = assertInsideData(cfg.outputDir);
  await mkdir(outDir, { recursive: true });
  const meta = await probeVideoMeta(input).catch(() => ({
    fps: DEFAULT_PLAYBACK_FPS,
    durationMs: 0,
    width: 0,
    height: 0,
    fpsFound: false,
  }));
  const extractFps = cfg.fps && cfg.fps > 0 ? cfg.fps : 0;
  const args = ffmpegExtractArgs({
    ...cfg,
    fps: extractFps,
    inputPath: input,
    outputDir: outDir,
  });
  const result = await run("ffmpeg", args);
  if (result.code !== 0) {
    fail("FFMPEG_FAILED", result.stderr.slice(0, 500) || "ffmpeg failed");
  }
  const names = (await readdir(outDir))
    .filter((n) => n.startsWith("frame_") && n.endsWith(".jpg"))
    .sort();
  if (names.length === 0) fail("FFMPEG_FAILED", "ffmpeg produced no frames");
  let sourceFps = meta.fps;
  if (!meta.fpsFound && extractFps <= 0) {
    const inferred = inferFpsFromCount(names.length, meta.durationMs);
    if (inferred > 0) sourceFps = inferred;
  }
  return {
    files: names.map((n) => path.join(outDir, n)),
    durationMs: meta.durationMs,
    sourceFps,
  };
}

export async function readJpegFileAsBase64(file: string): Promise<string> {
  const buf = await readFile(assertInsideData(file));
  return buf.toString("base64");
}

export async function readJpegFilesAsBase64(files: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const f of files) {
    out.push(await readJpegFileAsBase64(f));
  }
  return out;
}

export async function removeDir(dir: string): Promise<void> {
  const full = assertInsideData(dir);
  await rm(full, { recursive: true, force: true });
}

export async function concatJpegSequence(input: {
  projectId: string;
  fps: number;
  frames: { frameNumber: number; imageData: string }[];
}): Promise<{ outputPath: string; frameCount: number; provider: string }> {
  const { ensureProjectLayout, projectRoot, assertInsideData } = await import(
    "../storage/local"
  );
  await ensureProjectLayout(input.projectId);
  const seqDir = assertInsideData(path.join(projectRoot(input.projectId), "renders", "seq"));
  await mkdir(seqDir, { recursive: true });
  const sorted = [...input.frames].sort((a, b) => a.frameNumber - b.frameNumber);
  for (let i = 0; i < sorted.length; i += 1) {
    const file = path.join(seqDir, `frame_${String(i + 1).padStart(6, "0")}.jpg`);
    await writeFile(assertInsideData(file), Buffer.from(sorted[i].imageData, "base64"));
  }
  const out = assertInsideData(
    path.join(projectRoot(input.projectId), "renders", "preview.mp4"),
  );
  const pattern = path.join(seqDir, FRAME_FILE_PATTERN);
  const fps = Math.max(1, Math.min(60, Math.round(input.fps || DEFAULT_PLAYBACK_FPS)));
  const result = await run("ffmpeg", [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-loglevel",
    "error",
    "-framerate",
    String(fps),
    "-i",
    pattern,
    "-pix_fmt",
    "yuv420p",
    "-c:v",
    "libx264",
    out,
  ]);
  if (result.code !== 0) {
    const fallback = await run("ffmpeg", [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-loglevel",
      "error",
      "-framerate",
      String(fps),
      "-i",
      pattern,
      "-pix_fmt",
      "yuv420p",
      out,
    ]);
    if (fallback.code !== 0) {
      fail(
        "FFMPEG_FAILED",
        (result.stderr || fallback.stderr).slice(0, 500) || "ffmpeg concat failed",
      );
    }
  }
  return { outputPath: out, frameCount: sorted.length, provider: "ffmpeg" };
}

export { MAX_BYTES, ALLOWED_EXT, FRAME_FILE_PATTERN, dataRoot, safeFilename };
