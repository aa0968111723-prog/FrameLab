# GPU

`GET /api/system/devices`

```json
{ "cpu": true, "cuda": false, "gpu": null, "vram_gb": 0, "runtime": "python+node", "rtmpose": { "ok": true, "device": "cpu" } }
```

**RTMPose** runs through `workers/gpu-worker/rtmpose_worker.py` (YOLOX-tiny + RTMPose-s ONNX). CUDA is used when `CUDAExecutionProvider` exists; otherwise CPU. Other CUDA adapters (SAM 2, SEA-RAFT, RIFE, Wan) stay reserved.
