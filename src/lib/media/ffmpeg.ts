import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fail } from "../domain/errors";
import { assertInsideData, dataRoot, safeFilename } from "../storage/local";

const ALLOWED_EXT = new Set([".mp4", ".webm", ".mov", ".mkv", ".m4v", ".avi"]);
const MAX_BYTES = 48 * 1024 * 1024;

export type ExtractConfig = {
  inputPath: string;
  outputDir: string;
  fps: number;
  maxWidth: number;
  maxFrames: number;
};

export function clampExtractNumbers(fps: number, maxWidth: number, maxFrames: number) {
  const f = Math.max(1, Math.min(30, Math.round(fps)));
  const w = Math.max(32, Math.min(640, Math.round(maxWidth) & ~1));
  const n = Math.max(2, Math.min(160, Math.round(maxFrames)));
  return { fps: f, maxWidth: w, maxFrames: n };
}

export function ffmpegExtractArgs(cfg: ExtractConfig): string[] {
  const { fps, maxWidth, maxFrames } = clampExtractNumbers(
    cfg.fps,
    cfg.maxWidth,
    cfg.maxFrames,
  );
  const pattern = path.join(cfg.outputDir, "frame_%04d.jpg");
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-loglevel",
    "error",
    "-i",
    cfg.inputPath,
    "-vf",
    `fps=${fps},scale=${maxWidth}:-2:flags=lanczos`,
    "-q:v",
    "4",
    "-frames:v",
    String(maxFrames),
    pattern,
  ];
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
  const full = assertInsideData(inputPath);
  const result = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    full,
  ]);
  if (result.code !== 0) fail("FFMPEG_FAILED", result.stderr.slice(0, 400) || "ffprobe failed");
  const sec = Number.parseFloat(result.stdout.trim());
  if (!Number.isFinite(sec) || sec <= 0) return 0;
  return Math.round(sec * 1000);
}

export async function extractFramesWithFfmpeg(cfg: ExtractConfig): Promise<{
  files: string[];
  durationMs: number;
}> {
  const input = assertInsideData(cfg.inputPath);
  const ext = path.extname(input).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) fail("VALIDATION_ERROR", `Unsupported video type ${ext}`);
  const info = await stat(input);
  if (info.size > MAX_BYTES) fail("VALIDATION_ERROR", "Video exceeds 48MB cap");
  const outDir = assertInsideData(cfg.outputDir);
  await mkdir(outDir, { recursive: true });
  const durationMs = await probeDurationMs(input).catch(() => 0);
  const args = ffmpegExtractArgs({ ...cfg, inputPath: input, outputDir: outDir });
  const result = await run("ffmpeg", args);
  if (result.code !== 0) {
    fail("FFMPEG_FAILED", result.stderr.slice(0, 500) || "ffmpeg failed");
  }
  const names = (await readdir(outDir))
    .filter((n) => n.startsWith("frame_") && n.endsWith(".jpg"))
    .sort();
  if (names.length === 0) fail("FFMPEG_FAILED", "ffmpeg produced no frames");
  return {
    files: names.map((n) => path.join(outDir, n)),
    durationMs,
  };
}

export async function readJpegFilesAsBase64(files: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const f of files) {
    const buf = await readFile(assertInsideData(f));
    out.push(buf.toString("base64"));
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
    const file = path.join(seqDir, `frame_${String(i + 1).padStart(4, "0")}.jpg`);
    await writeFile(assertInsideData(file), Buffer.from(sorted[i].imageData, "base64"));
  }
  const out = assertInsideData(
    path.join(projectRoot(input.projectId), "renders", "preview.mp4"),
  );
  const pattern = path.join(seqDir, "frame_%04d.jpg");
  const fps = Math.max(1, Math.min(30, Math.round(input.fps || 12)));
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

export { MAX_BYTES, ALLOWED_EXT, dataRoot, safeFilename };
