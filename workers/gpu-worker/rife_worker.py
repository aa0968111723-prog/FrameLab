#!/usr/bin/env python3
"""FrameLab RIFE worker. Real Practical-RIFE 4.x interpolation.

stdin JSON:
  {
    "pathA": "/a.jpg",
    "pathB": "/b.jpg",
    "count": 3,
    "timesteps": [0.25, 0.5, 0.75],
    "outDir": "/tmp/rife-out"
  }

stdout: one JSON object. Logs go to stderr.
"""
from __future__ import annotations

import json
import os
import sys
import traceback

HF_REPO = "gpanaretou/practical-rife-interpolation"
HF_FILE = "train_log/flownet.pkl"
ROOT = os.path.dirname(os.path.abspath(__file__))
RIFE_DIR = os.path.join(ROOT, "rife")
TRAIN_LOG = os.path.join(RIFE_DIR, "train_log")
CKPT = os.path.join(TRAIN_LOG, "flownet.pkl")


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def pick_device() -> str:
    forced = os.environ.get("FRAMELAB_RIFE_DEVICE", "").strip().lower()
    if forced in ("cpu", "cuda"):
        return forced
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def health() -> dict:
    device = pick_device()
    torch_ok = False
    try:
        import torch  # noqa: F401

        torch_ok = True
    except Exception as exc:
        return {"ok": False, "provider": "rife", "device": device, "error": f"torch missing: {exc}"}
    code_ok = os.path.isfile(os.path.join(TRAIN_LOG, "IFNet_HDv3.py"))
    return {
        "ok": torch_ok and code_ok,
        "provider": "rife",
        "model": "rife-4.25",
        "device": device,
        "cuda": device == "cuda",
        "torch": torch_ok,
        "checkpoint": os.path.isfile(CKPT),
        "runtime": "python",
    }


_MODEL = None
_DEVICE = None


def ensure_ckpt() -> str:
    if os.path.isfile(CKPT):
        return CKPT
    os.makedirs(TRAIN_LOG, exist_ok=True)
    from huggingface_hub import hf_hub_download

    path = hf_hub_download(HF_REPO, HF_FILE, local_dir=RIFE_DIR)
    return path if os.path.isfile(path) else CKPT


def load_model(device: str):
    global _MODEL, _DEVICE
    if _MODEL is not None and _DEVICE == device:
        return _MODEL
    for p in (RIFE_DIR, TRAIN_LOG):
        if p not in sys.path:
            sys.path.insert(0, p)
    import contextlib
    import torch
    from IFNet_HDv3 import IFNet

    ckpt = ensure_ckpt()
    net = IFNet()
    with contextlib.redirect_stdout(sys.stderr):
        raw = torch.load(ckpt, map_location="cpu")
    if isinstance(raw, dict) and "state_dict" in raw:
        raw = raw["state_dict"]
    converted = {k.replace("module.", ""): v for k, v in raw.items()}
    net.load_state_dict(converted, strict=False)
    net.eval()
    net.to(device)
    _MODEL = net
    _DEVICE = device
    return net


def pad64(t):
    import torch.nn.functional as F

    _, _, h, w = t.shape
    ph = ((h + 63) // 64) * 64
    pw = ((w + 63) // 64) * 64
    if ph == h and pw == w:
        return t, h, w
    return F.pad(t, (0, pw - w, 0, ph - h)), h, w


def interpolate(net, device, img0, img1, timestep: float):
    import torch

    t0, h, w = pad64(img0)
    t1, _, _ = pad64(img1)
    imgs = torch.cat((t0, t1), 1).to(device)
    scale_list = [16, 8, 4, 2, 1]
    with torch.no_grad():
        _flow, _mask, merged = net(imgs, timestep, scale_list)
    out = merged[-1][:, :, :h, :w]
    return out.clamp(0, 1)


def run(payload: dict) -> dict:
    import cv2
    import numpy as np
    import torch

    device = pick_device()
    path_a = payload.get("pathA")
    path_b = payload.get("pathB")
    if not path_a or not path_b:
        return {"ok": False, "provider": "rife", "error": "pathA and pathB required"}
    a = cv2.imread(path_a)
    b = cv2.imread(path_b)
    if a is None or b is None:
        return {"ok": False, "provider": "rife", "error": "unreadable keyframes"}
    a = cv2.cvtColor(a, cv2.COLOR_BGR2RGB)
    b = cv2.cvtColor(b, cv2.COLOR_BGR2RGB)
    if a.shape != b.shape:
        b = cv2.resize(b, (a.shape[1], a.shape[0]), interpolation=cv2.INTER_LINEAR)
    img0 = torch.tensor(a, dtype=torch.float32).permute(2, 0, 1)[None] / 255.0
    img1 = torch.tensor(b, dtype=torch.float32).permute(2, 0, 1)[None] / 255.0
    count = max(1, int(payload.get("count") or 1))
    steps = payload.get("timesteps")
    if not isinstance(steps, list) or len(steps) != count:
        steps = [(i + 1) / (count + 1) for i in range(count)]
    out_dir = payload.get("outDir") or os.path.join(os.path.dirname(path_a), "rife-out")
    os.makedirs(out_dir, exist_ok=True)
    net = load_model(device)
    frames = []
    for i, ts in enumerate(steps):
        t = float(ts)
        pred = interpolate(net, device, img0, img1, t)
        rgb = (pred[0].detach().cpu().permute(1, 2, 0).numpy() * 255.0).clip(0, 255).astype(np.uint8)
        file = os.path.join(out_dir, f"ib_{i:03d}.jpg")
        cv2.imwrite(file, cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), [int(cv2.IMWRITE_JPEG_QUALITY), 92])
        frames.append({"index": i, "timestep": t, "path": file, "width": int(rgb.shape[1]), "height": int(rgb.shape[0])})
    return {
        "ok": True,
        "provider": "rife",
        "model": "rife-4.25",
        "device": device,
        "cuda": device == "cuda",
        "frames": frames,
    }


def main() -> int:
    if "--health" in sys.argv:
        h = health()
        emit(h)
        return 0 if h.get("ok") else 2
    raw = sys.stdin.read()
    if not raw.strip():
        emit({"ok": False, "error": "empty stdin"})
        return 2
    try:
        emit(run(json.loads(raw)))
        return 0
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        emit({"ok": False, "provider": "rife", "error": str(exc)})
        return 1


if __name__ == "__main__":
    sys.exit(main())
