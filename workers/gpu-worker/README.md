# GPU worker

Python **3.12 + PyTorch** HTTP service. Replaces the BusyBox stub.

```bash
python3 workers/gpu-worker/server.py --host 0.0.0.0 --port 8090
# or
docker compose -f docker-compose.gpu.yml up --build
```

| Path | What it reports |
| --- | --- |
| `GET /health` | process + torch + CUDA |
| `GET /device` | `cuda`, `gpu`, `vram_gb` from `torch.cuda` |
| `GET /models` | GPU models; `unavailable` when there is no CUDA |
| `GET /jobs` | in-flight worker jobs |
| `POST /jobs` | enqueue; **fails `GPU_UNAVAILABLE` if no CUDA** — never fake success |

No GPU → `status: "unavailable"`, `gpu: null`, `vram_gb: 0`.

## Inference CLIs

`UI → analyze_pose → POSE_ANALYSIS job → rtmpose_worker.py → YOLOX-tiny + RTMPose-s → poses → canvas skeleton`

```bash
pip install -r workers/gpu-worker/requirements.txt
python3 workers/gpu-worker/device.py
python3 workers/gpu-worker/rtmpose_worker.py --health
python3 workers/gpu-worker/locotrack_worker.py --health
python3 workers/gpu-worker/sea_raft_worker.py --health
python3 workers/gpu-worker/rife_worker.py --health
python3 workers/gpu-worker/sam2_worker.py --health
```
