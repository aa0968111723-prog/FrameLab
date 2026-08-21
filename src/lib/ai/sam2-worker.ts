/** Spawn the Python SAM 2 worker. Real SAM 2.1 video masks — not a bbox stub. */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type Sam2Health = {
  ok: boolean;
  provider: string;
  device: "cpu" | "cuda";
  cuda?: boolean;
  model?: string;
  error?: string;
};

export type Sam2Mask = {
  id?: string;
  frameNumber: number;
  objectId: string;
  bbox: { x: number; y: number; w: number; h: number };
  contour: number[][];
  score: number;
  confidence: number;
  status: "ok" | "warn" | "lost";
  area: number;
  direction?: string;
  warning?: string | null;
};

export type Sam2FrameIn = {
  id: string;
  path: string;
  frameNumber: number;
  width?: number;
  height?: number;
};

const WORKER = path.join(process.cwd(), "workers/gpu-worker/sam2_worker.py");

export function sam2WorkerPath(): string {
  return WORKER;
}

export function sam2Python(): string {
  return process.env.FRAMELAB_PYTHON || "python3";
}

function parseJsonBlob(text: string): Record<string, unknown> {
  const marker = text.indexOf('{"ok"');
  const slice = marker >= 0 ? text.slice(marker) : text;
  const start = slice.indexOf("{");
  const end = slice.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error(`SAM 2 worker produced no JSON: ${text.slice(0, 240)}`);
  }
  return JSON.parse(slice.slice(start, end + 1)) as Record<string, unknown>;
}

export function probeSam2(): Sam2Health {
  if (!existsSync(WORKER)) {
    return { ok: false, provider: "sam2", device: "cpu", error: "worker script missing" };
  }
  const r = spawnSync(sam2Python(), [WORKER, "--health"], {
    encoding: "utf8",
    timeout: 25_000,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  if (r.error) {
    return { ok: false, provider: "sam2", device: "cpu", error: r.error.message };
  }
  try {
    const j = parseJsonBlob(`${r.stdout || ""}\n${r.stderr || ""}`);
    return {
      ok: j.ok === true,
      provider: "sam2",
      device: j.device === "cuda" ? "cuda" : "cpu",
      cuda: j.cuda === true,
      model: typeof j.model === "string" ? j.model : "sam2.1-hiera-tiny",
      error: typeof j.error === "string" ? j.error : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      provider: "sam2",
      device: "cpu",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

let cachedHealth: { at: number; value: Sam2Health } | null = null;

export function sam2Available(): boolean {
  const now = Date.now();
  if (!cachedHealth || now - cachedHealth.at > 30_000) {
    cachedHealth = { at: now, value: probeSam2() };
  }
  return cachedHealth.value.ok;
}

export function sam2Health(): Sam2Health {
  if (!cachedHealth) sam2Available();
  return cachedHealth?.value ?? { ok: false, provider: "sam2", device: "cpu" };
}

export async function runSam2(input: {
  frames: Sam2FrameIn[];
  click: { x: number; y: number; frameNumber: number; label?: number; normalized?: boolean };
  objectId?: string;
  direction?: "forward" | "backward" | "both";
}): Promise<{
  device: "cpu" | "cuda";
  model: string;
  masks: Sam2Mask[];
  warnings: string[];
  degraded: boolean;
  clickFrame: number;
  objectId: string;
}> {
  const payload = JSON.stringify(input);
  const timeout = Math.min(300_000, 90_000 + input.frames.length * 8_000);
  const raw = await new Promise<string>((resolve, reject) => {
    const child = spawn(sam2Python(), [WORKER], {
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("SAM 2 worker timed out"));
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
        reject(new Error(err.slice(0, 500) || `SAM 2 worker exit ${code}`));
        return;
      }
      resolve(out || err);
    });
    child.stdin.write(payload);
    child.stdin.end();
  });
  const j = parseJsonBlob(raw);
  if (j.ok !== true) {
    throw new Error(typeof j.error === "string" ? j.error : "SAM 2 worker failed");
  }
  const masks = Array.isArray(j.masks) ? (j.masks as Sam2Mask[]) : [];
  const warnings = Array.isArray(j.warnings) ? (j.warnings as string[]) : [];
  return {
    device: j.device === "cuda" ? "cuda" : "cpu",
    model: typeof j.model === "string" ? j.model : "sam2.1-hiera-tiny",
    masks,
    warnings,
    degraded: j.degraded === true || warnings.length > 0 || masks.some((m) => m.status !== "ok"),
    clickFrame: typeof j.clickFrame === "number" ? j.clickFrame : input.click.frameNumber,
    objectId: typeof j.objectId === "string" ? j.objectId : input.objectId ?? "click",
  };
}
