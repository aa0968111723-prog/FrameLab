#!/usr/bin/env python3
"""FrameLab RTMPose worker. Real YOLOX + RTMPose ONNX via rtmlib/onnxruntime.

Reads JSON on stdin:
  {"images": [{"id": "...", "path": "/abs.jpg", "frameNumber": 0, "width": 0, "height": 0}]}

Writes one JSON object to stdout (logs go to stderr).
"""
from __future__ import annotations

import json
import os
import sys
import traceback

COCO17 = [
    "nose",
    "left_eye",
    "right_eye",
    "left_ear",
    "right_ear",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
]


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def pick_device() -> str:
    forced = os.environ.get("FRAMELAB_RTMPOSE_DEVICE", "").strip().lower()
    if forced in ("cpu", "cuda"):
        return forced
    try:
        import onnxruntime as ort

        if "CUDAExecutionProvider" in ort.get_available_providers():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def health() -> dict:
    device = pick_device()
    rtmlib_ok = False
    ort_ok = False
    try:
        import rtmlib  # noqa: F401

        rtmlib_ok = True
    except Exception as exc:
        return {
            "ok": False,
            "provider": "rtmpose",
            "device": device,
            "error": f"rtmlib missing: {exc}",
        }
    try:
        import onnxruntime as ort

        ort_ok = True
        providers = list(ort.get_available_providers())
    except Exception:
        providers = []
    return {
        "ok": True,
        "provider": "rtmpose",
        "model": "rtmpose-s",
        "detector": "yolox-tiny",
        "device": device,
        "cuda": device == "cuda",
        "rtmlib": rtmlib_ok,
        "onnxruntime": ort_ok,
        "providers": providers,
        "runtime": "python",
    }


_BODY = None
_DEVICE = None


def load_body(device: str):
    global _BODY, _DEVICE
    if _BODY is not None and _DEVICE == device:
        return _BODY
    import contextlib
    from rtmlib import Body

    with contextlib.redirect_stdout(sys.stderr):
        _BODY = Body(mode="lightweight", backend="onnxruntime", device=device, to_openpose=False)
    _DEVICE = device
    return _BODY


def bbox_from_kp(kp, scores, width: int, height: int, thr: float = 0.3):
    xs, ys = [], []
    for i, (x, y) in enumerate(kp):
        if float(scores[i]) < thr:
            continue
        xs.append(float(x))
        ys.append(float(y))
    if not xs:
        return {"x": 0, "y": 0, "w": 1, "h": 1}
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    pad_x = max(4.0, (x1 - x0) * 0.12)
    pad_y = max(4.0, (y1 - y0) * 0.12)
    x0 = max(0.0, x0 - pad_x)
    y0 = max(0.0, y0 - pad_y)
    x1 = min(float(width), x1 + pad_x)
    y1 = min(float(height), y1 + pad_y)
    return {
        "x": x0 / width,
        "y": y0 / height,
        "w": max(0.01, (x1 - x0) / width),
        "h": max(0.01, (y1 - y0) / height),
    }


def infer_image(body, path: str, width_hint: int, height_hint: int) -> dict:
    import cv2

    img = cv2.imread(path)
    if img is None:
        return {"people": 0, "keypoints": [], "bbox": {"x": 0, "y": 0, "w": 1, "h": 1}, "error": "unreadable"}
    h, w = img.shape[:2]
    width = width_hint or w
    height = height_hint or h
    keypoints, scores = body(img)
    if keypoints is None or len(keypoints) == 0:
        return {"people": 0, "keypoints": [], "bbox": {"x": 0, "y": 0, "w": 1, "h": 1}}
    # pick the highest-scoring person
    best_i = 0
    best = -1.0
    for i, sc in enumerate(scores):
        m = float(sum(sc) / max(1, len(sc)))
        if m > best:
            best = m
            best_i = i
    kp = keypoints[best_i]
    sc = scores[best_i]
    joints = []
    for i, name in enumerate(COCO17):
        x, y = float(kp[i][0]), float(kp[i][1])
        joints.append(
            {
                "name": name,
                "x": x / width,
                "y": y / height,
                "confidence": float(sc[i]),
            }
        )
    return {
        "people": int(len(keypoints)),
        "keypoints": joints,
        "bbox": bbox_from_kp(kp, sc, width, height),
    }


def run(payload: dict) -> dict:
    device = pick_device()
    body = load_body(device)
    images = payload.get("images") or []
    poses = []
    for item in images:
        path = item.get("path")
        rec = {
            "id": item.get("id"),
            "frameNumber": item.get("frameNumber"),
            "people": 0,
            "keypoints": [],
            "bbox": {"x": 0, "y": 0, "w": 1, "h": 1},
        }
        if not path or not os.path.isfile(path):
            rec["error"] = "missing file"
            poses.append(rec)
            continue
        got = infer_image(body, path, int(item.get("width") or 0), int(item.get("height") or 0))
        rec.update(got)
        poses.append(rec)
    return {
        "ok": True,
        "provider": "rtmpose",
        "model": "rtmpose-s",
        "detector": "yolox-tiny",
        "device": device,
        "cuda": device == "cuda",
        "poses": poses,
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
        payload = json.loads(raw)
        emit(run(payload))
        return 0
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        emit({"ok": False, "provider": "rtmpose", "error": str(exc)})
        return 1


if __name__ == "__main__":
    sys.exit(main())
