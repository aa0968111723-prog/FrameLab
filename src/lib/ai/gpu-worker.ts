/** Python 3.12 + PyTorch GPU worker client. Device facts come from torch.cuda. Never invented. */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type GpuDeviceInfo = {
  cpu: boolean;
  cuda: boolean;
  gpu: string | null;
  gpu_name: string | null;
  vram_gb: number;
  vram_used_gb: number;
  device_count: number;
  torch: boolean;
  torch_version: string | null;
  cuda_version: string | null;
  python: string | null;
  runtime: string;
  status: "ready" | "unavailable";
  note: string;
  error?: string;
};

const DEVICE_PY = path.join(process.cwd(), "workers/gpu-worker/device.py");

export function gpuWorkerPython(): string {
  return process.env.FRAMELAB_PYTHON || "python3";
}

export function gpuWorkerUrl(): string | null {
  const raw = (process.env.FRAMELAB_GPU_WORKER_URL || "").trim();
  if (!raw) return null;
  if (!/^https?:\/\/[a-zA-Z0-9.[\]:_-]+$/i.test(raw)) return null;
  return raw.replace(/\/$/, "");
}

function emptyUnavailable(note: string, error?: string): GpuDeviceInfo {
  return {
    cpu: true,
    cuda: false,
    gpu: null,
    gpu_name: null,
    vram_gb: 0,
    vram_used_gb: 0,
    device_count: 0,
    torch: false,
    torch_version: null,
    cuda_version: null,
    python: null,
    runtime: "python+pytorch",
    status: "unavailable",
    note,
    error,
  };
}

function normalizeDevice(raw: Record<string, unknown>): GpuDeviceInfo {
  const cuda = raw.cuda === true;
  const name = cuda && typeof raw.gpu_name === "string" ? raw.gpu_name : cuda && typeof raw.gpu === "string" ? raw.gpu : null;
  const vram = cuda && typeof raw.vram_gb === "number" && Number.isFinite(raw.vram_gb) ? raw.vram_gb : 0;
  return {
    cpu: true,
    cuda,
    gpu: cuda ? name : null,
    gpu_name: cuda ? name : null,
    vram_gb: cuda ? vram : 0,
    vram_used_gb: cuda && typeof raw.vram_used_gb === "number" ? raw.vram_used_gb : 0,
    device_count: cuda && typeof raw.device_count === "number" ? raw.device_count : 0,
    torch: raw.torch === true,
    torch_version: typeof raw.torch_version === "string" ? raw.torch_version : null,
    cuda_version: cuda && typeof raw.cuda_version === "string" ? raw.cuda_version : null,
    python: typeof raw.python === "string" ? raw.python : null,
    runtime: "python+pytorch",
    status: cuda ? "ready" : "unavailable",
    note:
      typeof raw.note === "string"
        ? raw.note
        : cuda
          ? "CUDA GPU ready"
          : "No CUDA GPU. GPU models stay unavailable.",
    error: typeof raw.error === "string" ? raw.error : undefined,
  };
}

function parseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function probeHttp(url: string): GpuDeviceInfo | null {
  const r = spawnSync(
    gpuWorkerPython(),
    [
      "-c",
      "import urllib.request,sys; sys.stdout.write(urllib.request.urlopen(sys.argv[1], timeout=0.8).read().decode())",
      `${url}/device`,
    ],
    { encoding: "utf8", timeout: 2500 },
  );
  if (r.status !== 0) return null;
  const json = parseJson(`${r.stdout || ""}\n${r.stderr || ""}`);
  return json ? normalizeDevice(json) : null;
}

function probeLocal(): GpuDeviceInfo {
  if (!existsSync(DEVICE_PY)) {
    return emptyUnavailable("GPU worker device.py missing.");
  }
  const r = spawnSync(gpuWorkerPython(), [DEVICE_PY], {
    encoding: "utf8",
    timeout: 15_000,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  if (r.error) return emptyUnavailable("Could not start Python device probe.", r.error.message);
  const json = parseJson(`${r.stdout || ""}\n${r.stderr || ""}`);
  if (!json) return emptyUnavailable("GPU worker produced no JSON.", (r.stderr || r.stdout || "").slice(0, 240));
  return normalizeDevice(json);
}

let cached: { at: number; value: GpuDeviceInfo } | null = null;

export function probeGpuDevice(force = false): GpuDeviceInfo {
  const now = Date.now();
  if (!force && cached && now - cached.at < 15_000) return cached.value;
  const url = gpuWorkerUrl();
  let value = url ? probeHttp(url) : null;
  if (!value) value = probeLocal();
  if (value.cuda !== true) {
    value = {
      ...value,
      cuda: false,
      gpu: null,
      gpu_name: null,
      vram_gb: 0,
      vram_used_gb: 0,
      status: "unavailable",
    };
  }
  cached = { at: now, value };
  return value;
}

export function gpuDeviceStatus(): "ready" | "unavailable" {
  return probeGpuDevice().status;
}
