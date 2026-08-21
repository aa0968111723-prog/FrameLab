# GPU

Python **3.12 + PyTorch** worker. BusyBox stubs are gone.

```bash
docker compose -f docker-compose.gpu.yml up --build
# GET http://127.0.0.1:8090/health
# GET http://127.0.0.1:8090/device
# GET http://127.0.0.1:8090/models
# GET http://127.0.0.1:8090/jobs
```

`GET /api/system/devices` (Node) reads the same facts:

```json
{ "cpu": true, "cuda": false, "gpu": null, "vram_gb": 0, "status": "unavailable", "runtime": "python+pytorch" }
```

CUDA, GPU name, and VRAM come from `torch.cuda.is_available()` / `get_device_name` / `get_device_properties().total_memory`. If there is no GPU the worker still starts and reports **`status: "unavailable"`**. It does not invent a device, VRAM, or a successful job.

POST `/jobs` without CUDA returns `GPU_UNAVAILABLE` and never marks the job completed.

Set `FRAMELAB_GPU_WORKER_URL=http://127.0.0.1:8090` so the Node app prefers the HTTP worker. Otherwise it runs `workers/gpu-worker/device.py` locally.

**RTMPose** runs through `workers/gpu-worker/rtmpose_worker.py`. **RIFE** through `rife_worker.py`. **SAM 2** through `sam2_worker.py` (SAM 2.1 hiera-tiny: click mask + forward/backward propagate). **LocoTrack** and **SEA-RAFT** keep their CLI workers. CUDA is used when PyTorch actually has it; otherwise CPU. Wan and Video Depth Anything stay reserved.
