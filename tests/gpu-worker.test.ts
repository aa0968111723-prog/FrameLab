import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { describe, it } from "node:test";
import { getDeviceInfo } from "../src/lib/ai/registry.ts";
import { probeGpuDevice } from "../src/lib/ai/gpu-worker.ts";

const ROOT = process.cwd();
const SERVER = path.join(ROOT, "workers/gpu-worker/server.py");
const DEVICE = path.join(ROOT, "workers/gpu-worker/device.py");
const DOCKERFILE = path.join(ROOT, "workers/gpu-worker/Dockerfile");
const COMPOSE = path.join(ROOT, "docker-compose.gpu.yml");

function python(): string {
  return process.env.FRAMELAB_PYTHON || "python3";
}

function getJson(url: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => {
        body += c;
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body) as Record<string, unknown>);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(4000, () => {
      req.destroy(new Error("timeout"));
    });
  });
}

function postJson(url: string, payload: unknown): Promise<{ code: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const raw = Buffer.from(JSON.stringify(payload));
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": raw.length },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () => {
          resolve({ code: res.statusCode ?? 0, json: JSON.parse(body) as Record<string, unknown> });
        });
      },
    );
    req.on("error", reject);
    req.write(raw);
    req.end();
  });
}

describe("GPU worker (Python 3.12 + PyTorch)", () => {
  it("replaces BusyBox with a Python 3.12 image", () => {
    const compose = fs.readFileSync(COMPOSE, "utf8");
    const docker = fs.readFileSync(DOCKERFILE, "utf8");
    const server = fs.readFileSync(SERVER, "utf8");
    assert.doesNotMatch(compose, /^\s*image:\s*busybox\b/m);
    assert.doesNotMatch(compose, /GPU worker not built/);
    assert.match(compose, /gpu-worker:/);
    assert.match(compose, /workers\/gpu-worker/);
    assert.match(docker, /FROM python:3\.12/);
    assert.match(docker, /torch/);
    assert.match(server, /\/health/);
    assert.match(server, /\/models/);
    assert.match(server, /\/jobs/);
    assert.match(server, /\/device/);
    assert.match(server, /GPU_UNAVAILABLE/);
    assert.match(fs.readFileSync(DEVICE, "utf8"), /torch\.cuda\.is_available/);
    assert.doesNotMatch(fs.readFileSync(DEVICE, "utf8"), /FRAMELAB_FAKE_GPU/);
  });

  it("device probe reports CUDA/GPU/VRAM from torch, unavailable without GPU", () => {
    const r = spawnSync(python(), [DEVICE], { encoding: "utf8", timeout: 20_000 });
    assert.equal(r.status, 0, r.stderr);
    const d = JSON.parse(r.stdout) as {
      cuda: boolean;
      gpu: string | null;
      vram_gb: number;
      status: string;
      torch: boolean;
    };
    assert.equal(d.torch, true);
    if (d.cuda) {
      assert.equal(d.status, "ready");
      assert.equal(typeof d.gpu, "string");
      assert.ok((d.gpu as string).length > 1);
      assert.ok(d.vram_gb > 0);
    } else {
      assert.equal(d.status, "unavailable");
      assert.equal(d.gpu, null);
      assert.equal(d.vram_gb, 0);
    }
  });

  it("getDeviceInfo never invents a GPU when CUDA is false", () => {
    const info = getDeviceInfo();
    const probe = probeGpuDevice(true);
    assert.equal(info.cpu, true);
    assert.equal(info.cuda, probe.cuda);
    if (!info.cuda) {
      assert.equal(info.gpu, null);
      assert.equal(info.vram_gb, 0);
      assert.equal(info.status, "unavailable");
    } else {
      assert.equal(typeof info.gpu, "string");
      assert.ok((info.vram_gb as number) > 0);
      assert.equal(info.status, "ready");
    }
    assert.match(String(info.runtime), /python\+pytorch/);
  });

  it("HTTP /health /models /jobs /device are real and honest", { timeout: 40_000 }, async () => {
    const port = 18090 + Math.floor(Math.random() * 200);
    const child = spawn(python(), [SERVER, "--host", "127.0.0.1", "--port", String(port)], {
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let boot = "";
    const started = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 12_000);
      const onData = (buf: Buffer) => {
        boot += buf.toString("utf8");
        if (/listening/.test(boot)) {
          clearTimeout(timer);
          resolve(true);
        }
      };
      child.stderr?.on("data", onData);
      child.stdout?.on("data", onData);
      child.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
      child.on("exit", () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
    try {
      assert.equal(started, true, boot);
      const base = `http://127.0.0.1:${port}`;
      const health = await getJson(`${base}/health`);
      const device = await getJson(`${base}/device`);
      const models = await getJson(`${base}/models`);
      const jobs = await getJson(`${base}/jobs`);
      assert.equal(health.service, "framelab-gpu-worker");
      assert.equal(typeof health.cuda, "boolean");
      assert.equal(device.cpu, true);
      assert.equal(device.cuda, health.cuda);
      if (device.cuda !== true) {
        assert.equal(device.status, "unavailable");
        assert.equal(device.gpu, null);
        assert.equal(device.vram_gb, 0);
        assert.equal(health.status, "unavailable");
      } else {
        assert.equal(device.status, "ready");
        assert.ok(typeof device.gpu === "string" && String(device.gpu).length > 1);
        assert.ok(Number(device.vram_gb) > 0);
      }
      const list = models.models as { id: string; status: string }[];
      assert.ok(Array.isArray(list) && list.length >= 5);
      assert.ok(list.some((m) => m.id === "rtmpose"));
      if (device.cuda !== true) {
        assert.ok(list.every((m) => m.status === "unavailable"));
      }
      assert.ok(Array.isArray(jobs.jobs));
      const posted = await postJson(`${base}/jobs`, { type: "rtmpose", payload: { frame: 0 } });
      if (device.cuda !== true) {
        assert.equal(posted.json.error_code, "GPU_UNAVAILABLE");
        assert.equal(posted.json.state, "failed");
        assert.equal(posted.json.ok, false);
        assert.notEqual(posted.json.state, "completed");
      }
    } finally {
      child.kill("SIGKILL");
    }
  });
});
