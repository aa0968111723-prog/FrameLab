# GPU

`GET /api/system/devices`

```json
{ "cpu": true, "cuda": false, "gpu": null, "vram_gb": 0, "runtime": "python+node", "rtmpose": { "ok": true, "device": "cpu" } }
```

**RTMPose** runs through `workers/gpu-worker/rtmpose_worker.py` (YOLOX-tiny + RTMPose-s ONNX). **RIFE** runs through `workers/gpu-worker/rife_worker.py`. CUDA is used when present; otherwise CPU. Other CUDA adapters (SAM 2, Wan) stay reserved.
