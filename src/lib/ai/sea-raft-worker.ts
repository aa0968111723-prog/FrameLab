/** Spawn the Python SEA-RAFT-S worker. Real two-frame optical flow — not an adapter stub. */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type SeaRaftHealth = {
  ok: boolean;
  provider: string;
  device: "cpu" | "cuda";
  cuda?: boolean;
  model?: string;
  error?: string;
};

export type SeaRaftCell = { x: number; y: number; dx: number; dy: number; mag: number };
export type SeaRaftPath = { x: number; y: number }[];

export type SeaRaftPair = {
  frameA: number;
  frameB: number;
  mean_motion: number;
  median_motion: number;
  dominant_direction: { x: number; y: number };
  grid: SeaRaftCell[];
  paths: SeaRaftPath[];
  confidence: number;
};

export type SeaRaftPairIn = {
  pathA: string;
  pathB: string;
  frameA: number;
  frameB: number;
  width?: number;
  height?: number;
};

const WORKER = path.join(process.cwd(), "workers/gpu-worker/sea_raft_worker.py");

export function seaRaftWorkerPath(): string {
  return WORKER;
}

export function seaRaftPython(): string {
  return process.env.FRAMELAB_PYTHON || "python3";
}

function parseJsonBlob(text: string): Record<string, unknown> {
  const marker = text.indexOf('{"ok"');
  const slice = marker >= 0 ? text.slice(marker) : text;
  const start = slice.indexOf("{");
  const end = slice.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error(`SEA-RAFT worker produced no JSON: ${text.slice(0, 240)}`);
  }
  return JSON.parse(slice.slice(start, end + 1)) as Record<string, unknown>;
}

export function probeSeaRaft(): SeaRaftHealth {
  if (!existsSync(WORKER)) {
    return { ok: false, provider: "sea-raft", device: "cpu", error: "worker script missing" };
  }
  const r = spawnSync(seaRaftPython(), [WORKER, "--health"], {
    encoding: "utf8",
    timeout: 25_000,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  if (r.error) {
    return { ok: false, provider: "sea-raft", device: "cpu", error: r.error.message };
  }
  try {
    const j = parseJsonBlob(`${r.stdout || ""}\n${r.stderr || ""}`);
    return {
      ok: j.ok === true,
      provider: "sea-raft",
      device: j.device === "cuda" ? "cuda" : "cpu",
      cuda: j.cuda === true,
      model: typeof j.model === "string" ? j.model : "sea-raft-s",
      error: typeof j.error === "string" ? j.error : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      provider: "sea-raft",
      device: "cpu",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

let cachedHealth: { at: number; value: SeaRaftHealth } | null = null;

export function seaRaftAvailable(): boolean {
  const now = Date.now();
  if (!cachedHealth || now - cachedHealth.at > 30_000) {
    cachedHealth = { at: now, value: probeSeaRaft() };
  }
  return cachedHealth.value.ok;
}

export function seaRaftHealth(): SeaRaftHealth {
  if (!cachedHealth) seaRaftAvailable();
  return cachedHealth?.value ?? { ok: false, provider: "sea-raft", device: "cpu" };
}

export async function runSeaRaft(input: { pairs: SeaRaftPairIn[] }): Promise<{
  device: "cpu" | "cuda";
  model: string;
  pairs: SeaRaftPair[];
}> {
  const payload = JSON.stringify(input);
  const timeout = Math.min(180_000, 40_000 + input.pairs.length * 8_000);
  const raw = await new Promise<string>((resolve, reject) => {
    const child = spawn(seaRaftPython(), [WORKER], {
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("SEA-RAFT worker timed out"));
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
        reject(new Error(err.slice(0, 500) || `SEA-RAFT worker exit ${code}`));
        return;
      }
      resolve(out || err);
    });
    child.stdin.write(payload);
    child.stdin.end();
  });
  const j = parseJsonBlob(raw);
  if (j.ok !== true) {
    throw new Error(typeof j.error === "string" ? j.error : "SEA-RAFT worker failed");
  }
  const pairs = Array.isArray(j.pairs) ? (j.pairs as SeaRaftPair[]) : [];
  return {
    device: j.device === "cuda" ? "cuda" : "cpu",
    model: typeof j.model === "string" ? j.model : "sea-raft-s",
    pairs,
  };
}
