#!/usr/bin/env python3
"""FrameLab SEA-RAFT-S worker. Real two-frame optical flow (ECCV 2024).

stdin JSON:
  {
    "pairs": [
      {"pathA": "/a.jpg", "pathB": "/b.jpg", "frameA": 10, "frameB": 11, "width": 640, "height": 360}
    ]
  }

stdout: one JSON object. Logs go to stderr.
"""
from __future__ import annotations

import json
import os
import sys
import traceback
from types import SimpleNamespace

HF_ID = "MemorySlices/Tartan-C368x496-S"
MAX_SIDE = 512
MIN_SIDE = 256
SAMPLE_CAP = 96
CODE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sea_raft", "core")


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def pick_device() -> str:
    forced = os.environ.get("FRAMELAB_SEARAFT_DEVICE", "").strip().lower()
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
        return {"ok": False, "provider": "sea-raft", "device": device, "error": f"torch missing: {exc}"}
    code_ok = os.path.isfile(os.path.join(CODE_DIR, "raft.py"))
    return {
        "ok": torch_ok and code_ok,
        "provider": "sea-raft",
        "model": "sea-raft-s",
        "device": device,
        "cuda": device == "cuda",
        "torch": torch_ok,
        "huggingface": HF_ID,
        "runtime": "python",
    }


_MODEL = None
_DEVICE = None


def sea_args():
    return SimpleNamespace(
        use_var=True,
        var_min=0,
        var_max=10,
        pretrain="resnet18",
        initial_dim=64,
        block_dims=[64, 128, 256],
        radius=4,
        dim=128,
        num_blocks=2,
        iters=4,
        dropout=0,
        epsilon=1e-8,
    )


def load_model(device: str):
    global _MODEL, _DEVICE
    if _MODEL is not None and _DEVICE == device:
        return _MODEL
    if CODE_DIR not in sys.path:
        sys.path.insert(0, CODE_DIR)
    os.chdir(CODE_DIR)
    import contextlib
    import torch
    from huggingface_hub import hf_hub_download
    from safetensors.torch import load_file
    from raft import RAFT

    with contextlib.redirect_stdout(sys.stderr):
        ckpt = hf_hub_download(HF_ID, "model.safetensors")
        model = RAFT(sea_args())
        model.load_state_dict(load_file(ckpt), strict=False)
    model.eval()
    model.to(device)
    _MODEL = model
    _DEVICE = device
    return model


def resize_pair(img_a, img_b):
    import cv2

    h, w = img_a.shape[:2]
    scale = 1.0
    longest = max(h, w)
    shortest = min(h, w)
    if longest > MAX_SIDE:
        scale = MAX_SIDE / longest
    elif shortest < MIN_SIDE:
        scale = MIN_SIDE / shortest
    nh = max(8, int(round(h * scale / 8) * 8))
    nw = max(8, int(round(w * scale / 8) * 8))
    if (nh, nw) != (h, w):
        img_a = cv2.resize(img_a, (nw, nh), interpolation=cv2.INTER_LINEAR)
        img_b = cv2.resize(img_b, (nw, nh), interpolation=cv2.INTER_LINEAR)
    return img_a, img_b, h, w


def sample_grid(dx, dy, src_w, src_h):
    import numpy as np

    H, W = dx.shape
    step = max(16, min(H, W) // 12)
    sx = src_w / W
    sy = src_h / H
    cells = []
    for y in range(step // 2, H, step):
        for x in range(step // 2, W, step):
            fx = float(dx[y, x]) * sx
            fy = float(dy[y, x]) * sy
            mag = float((fx * fx + fy * fy) ** 0.5)
            if mag < 0.35:
                continue
            cells.append(
                {
                    "x": round(x * sx, 2),
                    "y": round(y * sy, 2),
                    "dx": round(fx, 3),
                    "dy": round(fy, 3),
                    "mag": round(mag, 3),
                }
            )
    cells.sort(key=lambda c: c["mag"], reverse=True)
    return cells[:SAMPLE_CAP]


def infer_pair(model, device, path_a: str, path_b: str, src_w: int, src_h: int) -> dict:
    import cv2
    import numpy as np
    import torch

    a = cv2.imread(path_a)
    b = cv2.imread(path_b)
    if a is None or b is None:
        raise FileNotFoundError(f"unreadable pair {path_a} {path_b}")
    a = cv2.cvtColor(a, cv2.COLOR_BGR2RGB)
    b = cv2.cvtColor(b, cv2.COLOR_BGR2RGB)
    a, b, oh, ow = resize_pair(a, b)
    src_w = src_w or ow
    src_h = src_h or oh
    im1 = torch.tensor(a, dtype=torch.float32).permute(2, 0, 1)[None].to(device)
    im2 = torch.tensor(b, dtype=torch.float32).permute(2, 0, 1)[None].to(device)
    with torch.no_grad():
        out = model(im1, im2, iters=4, test_mode=True)
    flow = out["flow"][-1][0].detach().cpu().numpy()
    dx, dy = flow[0], flow[1]
    grid = sample_grid(dx, dy, src_w, src_h)
    mags = [c["mag"] for c in grid] or [0.0]
    mean = float(np.mean(mags))
    median = float(np.median(mags))
    if grid:
        wx = sum(c["dx"] for c in grid)
        wy = sum(c["dy"] for c in grid)
        n = max(1e-6, (wx * wx + wy * wy) ** 0.5)
        dom = {"x": round(wx / n, 3), "y": round(wy / n, 3)}
    else:
        dom = {"x": 0.0, "y": 0.0}
    paths = [[{"x": c["x"], "y": c["y"]}, {"x": c["x"] + c["dx"], "y": c["y"] + c["dy"]}] for c in grid[:12]]
    return {
        "mean_motion": round(mean, 3),
        "median_motion": round(median, 3),
        "dominant_direction": dom,
        "grid": grid,
        "paths": paths,
        "confidence": round(min(0.95, 0.4 + min(0.5, mean / 20)), 3),
    }


def run(payload: dict) -> dict:
    device = pick_device()
    pairs_in = payload.get("pairs") or []
    if not pairs_in:
        return {"ok": True, "provider": "sea-raft", "model": "sea-raft-s", "device": device, "pairs": []}
    model = load_model(device)
    out_pairs = []
    for item in pairs_in:
        stats = infer_pair(
            model,
            device,
            item["pathA"],
            item["pathB"],
            int(item.get("width") or 0),
            int(item.get("height") or 0),
        )
        out_pairs.append(
            {
                "frameA": int(item.get("frameA") or 0),
                "frameB": int(item.get("frameB") or 0),
                **stats,
            }
        )
    return {
        "ok": True,
        "provider": "sea-raft",
        "model": "sea-raft-s",
        "device": device,
        "cuda": device == "cuda",
        "pairs": out_pairs,
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
        emit({"ok": False, "provider": "sea-raft", "error": str(exc)})
        return 1


if __name__ == "__main__":
    sys.exit(main())
