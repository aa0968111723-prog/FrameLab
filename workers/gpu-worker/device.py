#!/usr/bin/env python3
"""Honest CUDA / GPU / VRAM probe. Never invent a device."""
from __future__ import annotations

import json
import sys


def _python_version() -> str:
    return f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"


def device_info() -> dict:
    info: dict = {
        "cpu": True,
        "cuda": False,
        "gpu": None,
        "gpu_name": None,
        "vram_gb": 0,
        "vram_used_gb": 0,
        "device_count": 0,
        "torch": False,
        "torch_version": None,
        "cuda_version": None,
        "python": _python_version(),
        "runtime": "python+pytorch",
        "status": "unavailable",
        "note": "PyTorch not loaded. GPU worker unavailable.",
    }
    try:
        import torch
    except Exception as exc:
        info["error"] = f"torch missing: {exc}"
        return info

    info["torch"] = True
    info["torch_version"] = str(getattr(torch, "__version__", "unknown"))
    cuda_ok = False
    try:
        cuda_ok = bool(torch.cuda.is_available())
    except Exception:
        cuda_ok = False

    if not cuda_ok:
        info["status"] = "unavailable"
        info["note"] = "PyTorch loaded; CUDA not available. GPU models stay unavailable."
        return info

    try:
        idx = int(torch.cuda.current_device())
        name = str(torch.cuda.get_device_name(idx))
        props = torch.cuda.get_device_properties(idx)
        total = float(getattr(props, "total_memory", 0) or 0)
        used = 0.0
        try:
            used = float(torch.cuda.memory_allocated(idx) or 0)
        except Exception:
            used = 0.0
        info.update(
            {
                "cuda": True,
                "gpu": name,
                "gpu_name": name,
                "vram_gb": round(total / (1024**3), 2),
                "vram_used_gb": round(used / (1024**3), 2),
                "device_count": int(torch.cuda.device_count() or 1),
                "cuda_version": str(getattr(torch.version, "cuda", None) or None),
                "status": "ready",
                "note": f"CUDA GPU ready: {name}",
            }
        )
    except Exception as exc:
        info["cuda"] = False
        info["gpu"] = None
        info["gpu_name"] = None
        info["vram_gb"] = 0
        info["status"] = "unavailable"
        info["error"] = str(exc)
        info["note"] = "torch.cuda.is_available() was true but device query failed. Reporting unavailable."
    return info


def health() -> dict:
    d = device_info()
    torch_ok = bool(d.get("torch"))
    return {
        "ok": torch_ok,
        "service": "framelab-gpu-worker",
        "runtime": "python+pytorch",
        "python": d.get("python"),
        "torch": d.get("torch"),
        "torch_version": d.get("torch_version"),
        "cuda": d.get("cuda") is True,
        "gpu": d.get("gpu") if d.get("cuda") else None,
        "vram_gb": d.get("vram_gb") if d.get("cuda") else 0,
        "status": d.get("status") or "unavailable",
        "note": d.get("note"),
        "error": d.get("error"),
    }


if __name__ == "__main__":
    sys.stdout.write(json.dumps(device_info(), ensure_ascii=False))
    sys.stdout.write("\n")
