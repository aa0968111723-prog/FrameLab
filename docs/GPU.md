# GPU

`GET /api/system/devices`

```json
{ "cpu": true, "cuda": false, "gpu": null, "vram_gb": 0, "runtime": "python+node", "rtmpose": { "ok": true, "device": "cpu" }, "sam2": { "ok": true, "device": "cpu" } }
```

**RTMPose** runs through `workers/gpu-worker/rtmpose_worker.py` (YOLOX-tiny + RTMPose-s ONNX). **RIFE** runs through `workers/gpu-worker/rife_worker.py`. **SAM 2** runs through `workers/gpu-worker/sam2_worker.py` (SAM 2.1 hiera-tiny video predictor: click mask + forward/backward propagate). CUDA is used when present; otherwise CPU. Other CUDA adapters (Wan, Video Depth Anything) stay reserved.
