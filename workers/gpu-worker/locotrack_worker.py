#!/usr/bin/env python3
"""FrameLab LocoTrack worker. Real LocoTrack-S (ECCV 2024) via PyTorch.

stdin JSON:
  {
    "frames": [{"path": "/abs.jpg", "frameNumber": 0, "width": 640, "height": 480}],
    "queries": [{"id": "q0", "name": "click", "x": 120, "y": 80, "frameNumber": 0}]
  }

stdout: one JSON object. Logs go to stderr.
"""
from __future__ import annotations

import json
import os
import sys
import traceback

MODEL_SIZE = "small"
INPUT_HW = 256
MAX_FRAMES = 128
CKPT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "locotrack",
    "weights",
    "locotrack_small.ckpt",
)
CODE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "locotrack")


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def pick_device() -> str:
    forced = os.environ.get("FRAMELAB_LOCOTRACK_DEVICE", "").strip().lower()
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
        return {"ok": False, "provider": "locotrack", "device": device, "error": f"torch missing: {exc}"}
    code_ok = os.path.isdir(os.path.join(CODE_DIR, "models"))
    ckpt_ok = os.path.isfile(CKPT)
    return {
        "ok": torch_ok and code_ok,
        "provider": "locotrack",
        "model": "locotrack-s",
        "device": device,
        "cuda": device == "cuda",
        "torch": torch_ok,
        "checkpoint": ckpt_ok,
        "runtime": "python",
    }


_MODEL = None
_DEVICE = None


def load_locotrack(device: str):
    global _MODEL, _DEVICE
    if _MODEL is not None and _DEVICE == device:
        return _MODEL
    if CODE_DIR not in sys.path:
        sys.path.insert(0, CODE_DIR)
    os.makedirs(os.path.dirname(CKPT), exist_ok=True)
    import contextlib
    import torch
    from models.locotrack_model import load_model

    ckpt = CKPT if os.path.isfile(CKPT) else None
    with contextlib.redirect_stdout(sys.stderr):
        model = load_model(ckpt, model_size=MODEL_SIZE)
    model.eval()
    model.to(device)
    _MODEL = model
    _DEVICE = device
    return model


def status_from_scores(vis: list[float]) -> list[str]:
    raw = []
    for v in vis:
        if v >= 0.5:
            raw.append("visible")
        elif v >= 0.2:
            raw.append("occluded")
        else:
            raw.append("lost")
    out = []
    saw_gap = False
    for s in raw:
        if s == "visible":
            out.append("recovered" if saw_gap else "visible")
            saw_gap = False
        else:
            saw_gap = True
            out.append(s)
    if out:
        out[0] = "visible" if raw[0] == "visible" else raw[0]
    return out


def run(payload: dict) -> dict:
    import cv2
    import numpy as np
    import torch

    device = pick_device()
    frames_in = payload.get("frames") or []
    queries = payload.get("queries") or []
    if not frames_in:
        return {"ok": True, "provider": "locotrack", "model": "locotrack-s", "device": device, "tracks": []}

    frames_in = sorted(frames_in, key=lambda f: int(f.get("frameNumber") or 0))
    if len(frames_in) > MAX_FRAMES and queries:
        seed_fn = int(queries[0].get("frameNumber") or 0)
        idx = min(range(len(frames_in)), key=lambda i: abs(int(frames_in[i].get("frameNumber") or 0) - seed_fn))
        lo = max(0, idx - MAX_FRAMES // 2)
        hi = min(len(frames_in), lo + MAX_FRAMES)
        lo = max(0, hi - MAX_FRAMES)
        frames_in = frames_in[lo:hi]

    images = []
    meta = []
    for item in frames_in:
        path = item.get("path")
        img = cv2.imread(path) if path else None
        if img is None:
            continue
        h, w = img.shape[:2]
        width = int(item.get("width") or w)
        height = int(item.get("height") or h)
        resized = cv2.resize(img, (INPUT_HW, INPUT_HW), interpolation=cv2.INTER_LINEAR)
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        images.append(rgb)
        meta.append(
            {
                "frameNumber": int(item.get("frameNumber") or 0),
                "width": width,
                "height": height,
            }
        )
    if not images:
        return {"ok": False, "provider": "locotrack", "error": "no readable frames"}

    video = np.stack(images, axis=0)  # T,H,W,3 in 0-1
    video = video * 2.0 - 1.0
    index_of = {m["frameNumber"]: i for i, m in enumerate(meta)}

    q_list = []
    q_meta = []
    for q in queries:
        fn = int(q.get("frameNumber") or 0)
        if fn not in index_of:
            nearest = min(index_of.keys(), key=lambda n: abs(n - fn)) if index_of else None
            if nearest is None:
                continue
            fn = nearest
        t = index_of[fn]
        w = meta[t]["width"]
        h = meta[t]["height"]
        x = float(q.get("x") or 0)
        y = float(q.get("y") or 0)
        qx = x * INPUT_HW / max(1, w)
        qy = y * INPUT_HW / max(1, h)
        q_list.append([t, qy, qx])  # TAP: t, y, x
        q_meta.append(q)

    if not q_list:
        return {
            "ok": True,
            "provider": "locotrack",
            "model": "locotrack-s",
            "device": device,
            "tracks": [],
            "note": "no query on loaded frames",
        }

    model = load_locotrack(device)
    video_t = torch.from_numpy(video).unsqueeze(0).to(device)  # 1,T,H,W,3
    query_t = torch.tensor([q_list], dtype=torch.float32, device=device)  # 1,N,3
    with torch.no_grad():
        out = model(video_t, query_t)
    tracks = out["tracks"][0].detach().cpu().numpy()  # N,T,2  x,y in 256 space
    occ = torch.sigmoid(out["occlusion"][0]).detach().cpu().numpy()
    if "expected_dist" in out:
        ed = torch.sigmoid(out["expected_dist"][0]).detach().cpu().numpy()
        vis = (1.0 - occ) * (1.0 - ed)
    else:
        vis = 1.0 - occ

    result_tracks = []
    T = len(meta)
    for n, q in enumerate(q_meta):
        vis_n = [float(vis[n, t]) for t in range(T)]
        statuses = status_from_scores(vis_n)
        samples = []
        for t, m in enumerate(meta):
            x256, y256 = float(tracks[n, t, 0]), float(tracks[n, t, 1])
            samples.append(
                {
                    "frameNumber": m["frameNumber"],
                    "x": x256 * m["width"] / INPUT_HW,
                    "y": y256 * m["height"] / INPUT_HW,
                    "score": vis_n[t],
                    "status": statuses[t],
                }
            )
        result_tracks.append(
            {
                "id": q.get("id"),
                "name": q.get("name"),
                "samples": samples,
            }
        )
    return {
        "ok": True,
        "provider": "locotrack",
        "model": "locotrack-s",
        "device": device,
        "cuda": device == "cuda",
        "tracks": result_tracks,
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
        emit({"ok": False, "provider": "locotrack", "error": str(exc)})
        return 1


if __name__ == "__main__":
    sys.exit(main())
