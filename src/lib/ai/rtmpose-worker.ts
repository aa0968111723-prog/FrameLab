/** Spawn the Python RTMPose worker. Real YOLOX + RTMPose ONNX — not an adapter stub. */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { PoseEstimate, PoseKeypoint } from "@/lib/domain/pose-lite";

export type RtmposeHealth = {
  ok: boolean;
  provider: string;
  device: "cpu" | "cuda";
  cuda?: boolean;
  model?: string;
  error?: string;
};

export type RtmposeFrameIn = {
  id: string;
  path: string;
  frameNumber: number;
  width?: number;
  height?: number;
};

export type RtmposeFrameOut = {
  id: string;
  frameNumber: number;
  people: number;
  keypoints: PoseKeypoint[];
  bbox: { x: number; y: number; w: number; h: number };
  error?: string;
};

const WORKER = path.join(process.cwd(), "workers/gpu-worker/rtmpose_worker.py");

export function rtmposeWorkerPath(): string {
  return WORKER;
}

export function rtmposePython(): string {
  return process.env.FRAMELAB_PYTHON || "python3";
}

function parseJsonBlob(text: string): Record<string, unknown> {
  const marker = text.indexOf('{"ok"');
  const slice = marker >= 0 ? text.slice(marker) : text;
  const start = slice.indexOf("{");
  const end = slice.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error(`RTMPose worker produced no JSON: ${text.slice(0, 240)}`);
  }
  return JSON.parse(slice.slice(start, end + 1)) as Record<string, unknown>;
}

export function probeRtmpose(): RtmposeHealth {
  if (!existsSync(WORKER)) {
    return { ok: false, provider: "rtmpose", device: "cpu", error: "worker script missing" };
  }
  const r = spawnSync(rtmposePython(), [WORKER, "--health"], {
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  if (r.error) {
    return { ok: false, provider: "rtmpose", device: "cpu", error: r.error.message };
  }
  try {
    const j = parseJsonBlob(`${r.stdout || ""}\n${r.stderr || ""}`);
    return {
      ok: j.ok === true,
      provider: "rtmpose",
      device: j.device === "cuda" ? "cuda" : "cpu",
      cuda: j.cuda === true,
      model: typeof j.model === "string" ? j.model : "rtmpose-s",
      error: typeof j.error === "string" ? j.error : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      provider: "rtmpose",
      device: "cpu",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

let cachedHealth: { at: number; value: RtmposeHealth } | null = null;

export function rtmposeAvailable(): boolean {
  const now = Date.now();
  if (!cachedHealth || now - cachedHealth.at > 30_000) {
    cachedHealth = { at: now, value: probeRtmpose() };
  }
  return cachedHealth.value.ok;
}

export function rtmposeHealth(): RtmposeHealth {
  if (!cachedHealth) rtmposeAvailable();
  return cachedHealth?.value ?? { ok: false, provider: "rtmpose", device: "cpu" };
}

export async function runRtmposeBatch(images: RtmposeFrameIn[]): Promise<{
  device: "cpu" | "cuda";
  model: string;
  poses: RtmposeFrameOut[];
}> {
  if (!images.length) return { device: rtmposeHealth().device, model: "rtmpose-s", poses: [] };
  const payload = JSON.stringify({ images });
  const timeout = Math.min(180_000, 20_000 + images.length * 4_000);
  const raw = await new Promise<string>((resolve, reject) => {
    const child = spawn(rtmposePython(), [WORKER], {
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("RTMPose worker timed out"));
    }, timeout);
    child.stdout.on("data", (c: Buffer) => {
      out += c.toString("utf8");
    });
    child.stderr.on("data", (c: Buffer) => {
      err += c.toString("utf8");
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out.includes("{")) {
        reject(new Error(err.slice(0, 500) || `RTMPose worker exit ${code}`));
        return;
      }
      resolve(out || err);
    });
    child.stdin.write(payload);
    child.stdin.end();
  });
  const j = parseJsonBlob(raw);
  if (j.ok !== true) {
    throw new Error(typeof j.error === "string" ? j.error : "RTMPose worker failed");
  }
  const poses = Array.isArray(j.poses) ? (j.poses as RtmposeFrameOut[]) : [];
  return {
    device: j.device === "cuda" ? "cuda" : "cpu",
    model: typeof j.model === "string" ? j.model : "rtmpose-s",
    poses,
  };
}

export function toPoseEstimate(frame: RtmposeFrameOut, frameId?: string): PoseEstimate {
  return {
    frame_id: frameId ?? frame.id,
    frame_number: frame.frameNumber,
    character_id: null,
    provider: "rtmpose",
    bbox: frame.bbox ?? { x: 0, y: 0, w: 1, h: 1 },
    keypoints: Array.isArray(frame.keypoints) ? frame.keypoints : [],
    note: frame.people
      ? `RTMPose-s / YOLOX-tiny · ${frame.people} person(s)`
      : "RTMPose-s: no person detected",
  };
}
