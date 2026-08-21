# GPU worker

Python processes used by FrameLab for real model inference.

## RTMPose

`UI → analyze_pose → POSE_ANALYSIS job → rtmpose_worker.py → YOLOX-tiny + RTMPose-s → poses → canvas skeleton`

## LocoTrack

`Canvas click → create_tracking_point → POINT_TRACKING job → locotrack_worker.py → LocoTrack-S → tracking_points → trail`

Statuses: visible / occluded / lost / recovered.

```bash
pip install -r workers/gpu-worker/requirements.txt
python3 workers/gpu-worker/rtmpose_worker.py --health
python3 workers/gpu-worker/locotrack_worker.py --health
```

CUDA is used when available; otherwise CPU. LocoTrack-S checkpoint downloads from Hugging Face on first run into `locotrack/weights/`.
