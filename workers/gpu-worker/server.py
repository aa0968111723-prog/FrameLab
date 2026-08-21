#!/usr/bin/env python3
"""FrameLab GPU worker HTTP API.

Python 3.12 + PyTorch. Endpoints: /health /models /jobs /device.
CUDA / GPU / VRAM come from torch.cuda. No GPU → status=unavailable. Never fake success.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from device import device_info, health  # noqa: E402

GPU_MODELS = [
    {"id": "rtmpose", "role": "pose", "needs_gpu": True},
    {"id": "locotrack", "role": "point_tracking", "needs_gpu": True},
    {"id": "sea-raft", "role": "optical_flow", "needs_gpu": True},
    {"id": "rife", "role": "interpolation", "needs_gpu": True},
    {"id": "sam2", "role": "segmentation", "needs_gpu": True},
    {"id": "wan", "role": "generative_repair", "needs_gpu": True, "reserved": True},
    {"id": "video-depth-anything", "role": "depth", "needs_gpu": True, "reserved": True},
    {"id": "comfyui", "role": "generative_repair", "needs_gpu": True, "reserved": True},
]

_JOBS: dict[str, dict] = {}
_LOCK = threading.Lock()


def _models_payload(dev: dict) -> dict:
    cuda = dev.get("cuda") is True
    models = []
    for m in GPU_MODELS:
        if m.get("reserved"):
            status = "unavailable"
            reason = "Reserved adapter. MODEL_NOT_AVAILABLE."
        elif not cuda:
            status = "unavailable"
            reason = "No CUDA GPU. Worker will not pretend these models are ready."
        else:
            status = "ready"
            reason = None
        models.append(
            {
                "id": m["id"],
                "role": m["role"],
                "device": "cuda" if cuda and status == "ready" else "cpu",
                "status": status,
                "reason": reason,
            }
        )
    return {"cuda": cuda, "gpu": dev.get("gpu") if cuda else None, "models": models}


def _new_job(body: dict) -> dict:
    job_type = str(body.get("type") or body.get("kind") or "unknown")
    payload = body.get("payload") if isinstance(body.get("payload"), dict) else {}
    job_id = f"flgpu_{uuid.uuid4().hex[:16]}"
    now = time.time()
    job = {
        "id": job_id,
        "type": job_type,
        "state": "queued",
        "progress": 0,
        "payload": payload,
        "created_at": now,
        "error_code": None,
        "error": None,
        "ok": False,
    }
    dev = device_info()
    if dev.get("cuda") is not True:
        job.update(
            {
                "state": "failed",
                "progress": 0,
                "ok": False,
                "error_code": "GPU_UNAVAILABLE",
                "error": "No CUDA GPU. Job not started. Will not fake inference.",
            }
        )
    else:
        job.update({"state": "queued", "ok": True, "progress": 0})
    with _LOCK:
        _JOBS[job_id] = job
    return job


def _list_jobs() -> dict:
    with _LOCK:
        jobs = list(_JOBS.values())
    jobs.sort(key=lambda j: j.get("created_at") or 0, reverse=True)
    return {"jobs": jobs}


def _get_job(job_id: str) -> dict | None:
    with _LOCK:
        job = _JOBS.get(job_id)
        return dict(job) if job else None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        sys.stderr.write("gpu-worker: " + (fmt % args) + "\n")

    def _send(self, code: int, payload: dict) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            return {}
        return data if isinstance(data, dict) else {}

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path in ("/", "/health"):
            self._send(200, health())
            return
        if path == "/device":
            self._send(200, device_info())
            return
        if path == "/models":
            self._send(200, _models_payload(device_info()))
            return
        if path == "/jobs":
            self._send(200, _list_jobs())
            return
        if path.startswith("/jobs/"):
            job = _get_job(path.split("/", 2)[-1])
            if not job:
                self._send(404, {"ok": False, "error_code": "JOB_NOT_FOUND", "error": "Job not found"})
                return
            self._send(200, job)
            return
        self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path == "/jobs":
            job = _new_job(self._read_json())
            code = 200 if job.get("state") != "failed" else 409
            self._send(code, job)
            return
        self._send(404, {"ok": False, "error": "not found"})


def serve(host: str = "0.0.0.0", port: int = 8090) -> None:
    httpd = ThreadingHTTPServer((host, port), Handler)
    sys.stderr.write(f"framelab-gpu-worker listening on {host}:{port}\n")
    httpd.serve_forever()


if __name__ == "__main__":
    host = "0.0.0.0"
    port = int(os.environ.get("FRAMELAB_GPU_WORKER_PORT") or 8090)
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] in ("--host",) and i + 1 < len(args):
            host = args[i + 1]
            i += 2
            continue
        if args[i] in ("--port", "-p") and i + 1 < len(args):
            port = int(args[i + 1])
            i += 2
            continue
        if args[i] == "--health":
            sys.stdout.write(json.dumps(health(), ensure_ascii=False) + "\n")
            sys.exit(0 if health().get("torch") else 1)
        if args[i] == "--device":
            sys.stdout.write(json.dumps(device_info(), ensure_ascii=False) + "\n")
            sys.exit(0)
        i += 1
    serve(host, port)
