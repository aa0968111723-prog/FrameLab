/** Spawn the Python LocoTrack-S worker. Real ECCV 2024 inference — not an adapter stub. */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { TrackedPoint } from "@/lib/domain/ncc-tracker";
import type { TrackStatus } from "@/lib/domain/types";

export type LocotrackHealth = {
  ok: boolean;
  provider: string;
  device: "cpu" | "cuda";
  cuda?: boolean;
  model?: string;
  error?: string;
};

export type LocotrackFrameIn = {
  path: string;
  frameNumber: number;
  width?: number;
  height?: number;
};

export type LocotrackQuery = {
  id?: string;
  name: string;
  x: number;
  y: number;
  frameNumber: number;
};

export type LocotrackSample = {
  frameNumber: number;
  x: number;
  y: number;
  score: number;
  status: TrackStatus;
};

const WORKER = path.join(process.cwd(), "workers/gpu-worker/locotrack_worker.py");

export function locotrackWorkerPath(): string {
  return WORKER;
}

export function locotrackPython(): string {
  return process.env.FRAMELAB_PYTHON || "python3";
}

function parseJsonBlob(text: string): Record<string, unknown> {
  const marker = text.indexOf('{"ok"');
  const slice = marker >= 0 ? text.slice(marker) : text;
  const start = slice.indexOf("{");
  const end = slice.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error(`LocoTrack worker produced no JSON: ${text.slice(0, 240)}`);
  }
  return JSON.parse(slice.slice(start, end + 1)) as Record<string, unknown>;
}

export function probeLocotrack(): LocotrackHealth {
  if (!existsSync(WORKER)) {
    return { ok: false, provider: "locotrack", device: "cpu", error: "worker script missing" };
  }
  const r = spawnSync(locotrackPython(), [WORKER, "--health"], {
    encoding: "utf8",
    timeout: 25_000,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  if (r.error) {
    return { ok: false, provider: "locotrack", device: "cpu", error: r.error.message };
  }
  try {
    const j = parseJsonBlob(`${r.stdout || ""}\n${r.stderr || ""}`);
    return {
      ok: j.ok === true,
      provider: "locotrack",
      device: j.device === "cuda" ? "cuda" : "cpu",
      cuda: j.cuda === true,
      model: typeof j.model === "string" ? j.model : "locotrack-s",
      error: typeof j.error === "string" ? j.error : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      provider: "locotrack",
      device: "cpu",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

let cachedHealth: { at: number; value: LocotrackHealth } | null = null;

export function locotrackAvailable(): boolean {
  const now = Date.now();
  if (!cachedHealth || now - cachedHealth.at > 30_000) {
    cachedHealth = { at: now, value: probeLocotrack() };
  }
  return cachedHealth.value.ok;
}

export function locotrackHealth(): LocotrackHealth {
  if (!cachedHealth) locotrackAvailable();
  return cachedHealth?.value ?? { ok: false, provider: "locotrack", device: "cpu" };
}

export async function runLocotrack(input: {
  frames: LocotrackFrameIn[];
  queries: LocotrackQuery[];
}): Promise<{
  device: "cpu" | "cuda";
  model: string;
  tracks: { id?: string; name: string; samples: LocotrackSample[] }[];
}> {
  const payload = JSON.stringify(input);
  const timeout = Math.min(180_000, 25_000 + input.frames.length * 250);
  const raw = await new Promise<string>((resolve, reject) => {
    const child = spawn(locotrackPython(), [WORKER], {
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("LocoTrack worker timed out"));
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
        reject(new Error(err.slice(0, 500) || `LocoTrack worker exit ${code}`));
        return;
      }
      resolve(out || err);
    });
    child.stdin.write(payload);
    child.stdin.end();
  });
  const j = parseJsonBlob(raw);
  if (j.ok !== true) {
    throw new Error(typeof j.error === "string" ? j.error : "LocoTrack worker failed");
  }
  const tracks = Array.isArray(j.tracks)
    ? (j.tracks as { id?: string; name: string; samples: LocotrackSample[] }[])
    : [];
  return {
    device: j.device === "cuda" ? "cuda" : "cpu",
    model: typeof j.model === "string" ? j.model : "locotrack-s",
    tracks,
  };
}

export function samplesToTrackedPoints(
  samples: LocotrackSample[],
  frameNumbers: number[],
): TrackedPoint[] {
  const by = new Map(samples.map((s) => [s.frameNumber, s]));
  return frameNumbers.map((n, frameIndex) => {
    const s = by.get(n);
    if (!s) {
      return { frameIndex, x: 0, y: 0, score: 0, status: "lost" as TrackStatus };
    }
    return {
      frameIndex,
      x: s.x,
      y: s.y,
      score: s.score,
      status: s.status,
    };
  });
}
