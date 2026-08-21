#!/usr/bin/env python3
"""FrameLab SAM 2 worker. Real SAM 2.1 video masks — not a bbox stub.

stdin JSON:
  {
    "frames": [{"id": "...", "path": "/abs.jpg", "frameNumber": 0, "width": 320, "height": 180}],
    "click": {"x": 120, "y": 80, "frameNumber": 0, "label": 1},
    "objectId": "char-1",
    "direction": "both"
  }

stdout: one JSON object. Logs go to stderr.
Low-confidence tracks are status=warn|lost and listed in warnings.
Never report ok when the mask is empty or the track collapsed.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import traceback

MODEL_ID = os.environ.get("FRAMELAB_SAM2_MODEL", "facebook/sam2.1-hiera-tiny")
MAX_FRAMES = 48
OK_MIN = 0.55
WARN_MIN = 0.35
MIN_AREA = 0.002
# A click that paints almost the whole frame is almost never a real object.
MAX_AREA = 0.92

def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def pick_device() -> str:
    forced = os.environ.get("FRAMELAB_SAM2_DEVICE", "").strip().lower()
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
    sam_ok = False
    try:
        import torch  # noqa: F401

        torch_ok = True
    except Exception as exc:
        return {"ok": False, "provider": "sam2", "device": device, "error": f"torch missing: {exc}"}
    try:
        from sam2.sam2_video_predictor import SAM2VideoPredictor  # noqa: F401

        sam_ok = True
    except Exception as exc:
        return {"ok": False, "provider": "sam2", "device": device, "error": f"sam2 missing: {exc}"}
    return {
        "ok": torch_ok and sam_ok,
        "provider": "sam2",
        "model": "sam2.1-hiera-tiny",
        "device": device,
        "cuda": device == "cuda",
        "torch": torch_ok,
        "sam2": sam_ok,
        "runtime": "python",
    }


_PREDICTOR = None
_DEVICE = None


def load_predictor(device: str):
    global _PREDICTOR, _DEVICE
    if _PREDICTOR is not None and _DEVICE == device:
        return _PREDICTOR
    from sam2.sam2_video_predictor import SAM2VideoPredictor

    _PREDICTOR = SAM2VideoPredictor.from_pretrained(MODEL_ID, device=device)
    _DEVICE = device
    return _PREDICTOR


def to_pixels(x: float, y: float, width: int, height: int) -> tuple[float, float]:
    """Canvas and tests send pixels. Values in [0,1]x[0,1] are treated as normalised."""
    if 0.0 <= x <= 1.0 and 0.0 <= y <= 1.0:
        return x * max(1, width), y * max(1, height)
    return x, y


def mask_stats(mask, logits=None):
    import numpy as np

    binary = np.asarray(mask).astype(bool)
    h, w = binary.shape[-2], binary.shape[-1]
    flat = binary.reshape(h, w)
    area = float(flat.sum()) / float(max(1, h * w))
    if logits is not None:
        import torch

        t = logits.detach().float().cpu()
        if t.ndim == 3:
            t = t[0]
        pos = t > 0
        if bool(pos.any()):
            prob = torch.sigmoid(t)
            score = float(prob[pos].mean())
        else:
            score = 0.0
    else:
        score = 1.0 if area > 0 else 0.0
    ys, xs = np.where(flat)
    if xs.size == 0:
        bbox = {"x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0}
        contour: list[list[float]] = []
    else:
        x0, x1 = int(xs.min()), int(xs.max())
        y0, y1 = int(ys.min()), int(ys.max())
        bbox = {
            "x": x0 / max(1, w),
            "y": y0 / max(1, h),
            "w": (x1 - x0 + 1) / max(1, w),
            "h": (y1 - y0 + 1) / max(1, h),
        }
        contour = contour_of(flat, w, h)
    return area, score, bbox, contour


def contour_of(flat, w: int, h: int) -> list[list[float]]:
    try:
        import cv2
        import numpy as np
    except Exception:
        return []
    img = (flat.astype(np.uint8)) * 255
    cnts, _ = cv2.findContours(img, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return []
    largest = max(cnts, key=cv2.contourArea)
    peri = cv2.arcLength(largest, True)
    approx = cv2.approxPolyDP(largest, max(1.5, 0.004 * peri), True)
    pts = approx.reshape(-1, 2)
    if len(pts) > 64:
        step = max(1, len(pts) // 64)
        pts = pts[::step]
    return [[float(p[0]) / max(1, w), float(p[1]) / max(1, h)] for p in pts]


def classify(score: float, area: float, prev_area: float | None) -> tuple[str, str | None]:
    if area < MIN_AREA or score < WARN_MIN:
        return "lost", f"遮罩信心 {score:.2f}，面積 {area:.3f} — 追蹤失敗，不是成功"
    if area > MAX_AREA:
        return "lost", f"遮罩幾乎鋪滿整格（面積 {area:.2f}）— 點到空白，不是成功"
    if score < OK_MIN:
        return "warn", f"遮罩信心 {score:.2f} — 低於可用門檻，未假裝成功"
    if prev_area and prev_area > MIN_AREA:
        ratio = area / prev_area
        if ratio < 0.3 or ratio > 3.5:
            return "warn", f"遮罩面積突變 {ratio:.2f}× — 傳播不穩"
    return "ok", None


def pack_mask(frame, obj_id: str, mask, logits, prev_area: float | None, direction: str):
    area, score, bbox, contour = mask_stats(mask, logits)
    status, warning = classify(score, area, prev_area)
    return {
        "id": frame.get("id"),
        "frameNumber": frame["frameNumber"],
        "objectId": obj_id,
        "bbox": bbox,
        "contour": contour,
        "score": round(score, 4),
        "confidence": round(score, 4),
        "status": status,
        "area": round(area, 5),
        "direction": direction,
        "warning": warning,
    }, area


def run(payload: dict) -> dict:
    device = pick_device()
    frames = payload.get("frames") or []
    click = payload.get("click") or {}
    if not frames:
        return {"ok": False, "provider": "sam2", "device": device, "error": "frames required"}
    if click.get("x") is None or click.get("y") is None:
        return {"ok": False, "provider": "sam2", "device": device, "error": "click x,y required"}
    direction = str(payload.get("direction") or "both").lower()
    if direction not in ("forward", "backward", "both"):
        direction = "both"
    obj_id = str(payload.get("objectId") or payload.get("name") or "click")
    click_frame = int(click.get("frameNumber") or frames[0]["frameNumber"])
    idx_map = {int(f["frameNumber"]): i for i, f in enumerate(frames)}
    if click_frame not in idx_map:
        nearest = min(idx_map.keys(), key=lambda n: abs(n - click_frame))
        click_frame = nearest
    click_idx = idx_map[click_frame]
    # Window around the click so CPU jobs stay honest instead of silently dropping work.
    lo = max(0, click_idx - MAX_FRAMES // 2)
    hi = min(len(frames), lo + MAX_FRAMES)
    lo = max(0, hi - MAX_FRAMES)
    window = frames[lo:hi]
    click_idx = next(i for i, f in enumerate(window) if int(f["frameNumber"]) == click_frame)
    predictor = load_predictor(device)
    tmp = tempfile.mkdtemp(prefix="framelab-sam2-")
    try:
        for i, f in enumerate(window):
            src = f["path"]
            if not os.path.isfile(src):
                return {"ok": False, "provider": "sam2", "device": device, "error": f"missing frame {src}"}
            dst = os.path.join(tmp, f"{i:05d}.jpg")
            shutil.copy(src, dst)
        state = predictor.init_state(
            video_path=tmp,
            offload_video_to_cpu=True,
            offload_state_to_cpu=device == "cpu",
        )
        video_w = int(state.get("video_width") or window[click_idx].get("width") or 1)
        video_h = int(state.get("video_height") or window[click_idx].get("height") or 1)
        px, py = to_pixels(float(click["x"]), float(click["y"]), video_w, video_h)
        import numpy as np

        # SAM2 always multiplies by image_size after this step. With
        # normalize_coords=True it first divides by (W, H), so we must pass
        # pixels — not [0,1]. False + pixels blows the point off-canvas and
        # returns an all-NO_OBJ_SCORE empty mask.
        points = np.array([[px, py]], dtype=np.float32)
        labels = np.array([int(click.get("label") or 1)], dtype=np.int32)
        _, _, click_masks = predictor.add_new_points_or_box(
            inference_state=state,
            frame_idx=click_idx,
            obj_id=1,
            points=points,
            labels=labels,
            clear_old_points=True,
            normalize_coords=True,
        )
        collected: dict[int, dict] = {}
        warnings: list[str] = []

        def ingest(frame_idx: int, video_res_masks, direction_label: str, prev_area: float | None):
            if frame_idx < 0 or frame_idx >= len(window):
                return prev_area
            t = video_res_masks[0]
            try:
                import torch

                logits = t.detach() if hasattr(t, "detach") else None
                binary = (t > 0).detach().cpu().numpy() if hasattr(t, "detach") else (np.asarray(t) > 0)
                if binary.ndim == 3:
                    binary = binary[0]
            except Exception:
                logits = None
                binary = np.asarray(t) > 0
            packed, area = pack_mask(window[frame_idx], obj_id, binary, logits, prev_area, direction_label)
            collected[frame_idx] = packed
            if packed.get("warning"):
                warnings.append(f"F{packed['frameNumber']} {packed['warning']}")
            return packed["area"]

        prev = ingest(click_idx, click_masks, "seed", None)
        seed = collected.get(click_idx)
        if seed is None or seed["status"] == "lost" or seed["area"] < MIN_AREA:
            return {
                "ok": False,
                "provider": "sam2",
                "model": "sam2.1-hiera-tiny",
                "device": device,
                "error": "SAM 2 produced an empty mask. Not a success.",
                "masks": [seed] if seed else [],
                "warnings": warnings or ["空遮罩"],
            }
        if direction in ("backward", "both") and click_idx > 0:
            for fi, _ids, logits in predictor.propagate_in_video(
                state, start_frame_idx=click_idx, reverse=True
            ):
                prev = ingest(fi, logits, "backward", prev if fi != click_idx else None)
        if direction in ("forward", "both") and click_idx < len(window) - 1:
            for fi, _ids, logits in predictor.propagate_in_video(
                state, start_frame_idx=click_idx, reverse=False
            ):
                prev = ingest(fi, logits, "forward" if fi != click_idx else "seed", prev if fi != click_idx else None)

        masks = [collected[i] for i in sorted(collected)]
        any_bad = any(m["status"] != "ok" for m in masks)
        return {
            "ok": True,
            "provider": "sam2",
            "model": "sam2.1-hiera-tiny",
            "device": device,
            "objectId": obj_id,
            "clickFrame": click_frame,
            "direction": direction,
            "masks": masks,
            "warnings": warnings,
            "degraded": any_bad,
            "note": "SAM 2.1 hiera-tiny real video propagation. Low-confidence frames are warn/lost.",
        }
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> None:
    if "--health" in sys.argv:
        emit(health())
        return
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except Exception as exc:
        emit({"ok": False, "provider": "sam2", "error": f"invalid json: {exc}"})
        return
    try:
        emit(run(payload))
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        emit({"ok": False, "provider": "sam2", "device": pick_device(), "error": str(exc)})


if __name__ == "__main__":
    main()
