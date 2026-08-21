/** Spawn the Python RIFE worker. Real Practical-RIFE interpolation — not linear blend. */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type RifeHealth = {
  ok: boolean;
  provider: string;
  device: "cpu" | "cuda";
  cuda?: boolean;
  model?: string;
  error?: string;
};

export type RifeFrameOut = {
  index: number;
  timestep: number;
  path: string;
  width: number;
  height: number;
};

const WORKER = path.join(process.cwd(), "workers/gpu-worker/rife_worker.py");

export function rifeWorkerPath(): string {
  return WORKER;
}

export function rifePython(): string {
  return process.env.FRAMELAB_PYTHON || "python3";
}

function parseJsonBlob(text: string): Record<string, unknown> {
  const marker = text.indexOf('{"ok"');
  const slice = marker >= 0 ? text.slice(marker) : text;
  const start = slice.indexOf("{");
  const end = slice.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error(`RIFE worker produced no JSON: ${text.slice(0, 240)}`);
  }
  return JSON.parse(slice.slice(start, end + 1)) as Record<string, unknown>;
}

export function probeRife(): RifeHealth {
  if (!existsSync(WORKER)) {
    return { ok: false, provider: "rife", device: "cpu", error: "worker script missing" };
  }
  const r = spawnSync(rifePython(), [WORKER, "--health"], {
    encoding: "utf8",
    timeout: 25_000,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  if (r.error) {
    return { ok: false, provider: "rife", device: "cpu", error: r.error.message };
  }
  try {
    const j = parseJsonBlob(`${r.stdout || ""}\n${r.stderr || ""}`);
    return {
      ok: j.ok === true,
      provider: "rife",
      device: j.device === "cuda" ? "cuda" : "cpu",
      cuda: j.cuda === true,
      model: typeof j.model === "string" ? j.model : "rife-4.25",
      error: typeof j.error === "string" ? j.error : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      provider: "rife",
      device: "cpu",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

let cachedHealth: { at: number; value: RifeHealth } | null = null;

export function rifeAvailable(): boolean {
  const now = Date.now();
  if (!cachedHealth || now - cachedHealth.at > 30_000) {
    cachedHealth = { at: now, value: probeRife() };
  }
  return cachedHealth.value.ok;
}

export function rifeHealth(): RifeHealth {
  if (!cachedHealth) rifeAvailable();
  return cachedHealth?.value ?? { ok: false, provider: "rife", device: "cpu" };
}

export async function runRife(input: {
  pathA: string;
  pathB: string;
  count: number;
  timesteps?: number[];
  outDir: string;
}): Promise<{ device: "cpu" | "cuda"; model: string; frames: RifeFrameOut[] }> {
  const payload = JSON.stringify(input);
  const timeout = Math.min(180_000, 40_000 + input.count * 8_000);
  const raw = await new Promise<string>((resolve, reject) => {
    const child = spawn(rifePython(), [WORKER], {
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("RIFE worker timed out"));
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
        reject(new Error(err.slice(0, 500) || `RIFE worker exit ${code}`));
        return;
      }
      resolve(out || err);
    });
    child.stdin.write(payload);
    child.stdin.end();
  });
  const j = parseJsonBlob(raw);
  if (j.ok !== true) {
    throw new Error(typeof j.error === "string" ? j.error : "RIFE worker failed");
  }
  const frames = Array.isArray(j.frames) ? (j.frames as RifeFrameOut[]) : [];
  return {
    device: j.device === "cuda" ? "cuda" : "cpu",
    model: typeof j.model === "string" ? j.model : "rife-4.25",
    frames,
  };
}
