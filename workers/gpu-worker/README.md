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
python3 workers/gpu-worker/sea_raft_worker.py --health
python3 workers/gpu-worker/rife_worker.py --health
```

## SEA-RAFT

`UI → analyze_motion → OPTICAL_FLOW job → sea_raft_worker.py → SEA-RAFT-S → flow JSON → canvas sampled vectors + path`

Two frames run real inference. `block-match-16` is CPU fallback only.

## RIFE

`Keyframe A/B → generate_inbetweens → RIFE-4.25 → Candidate Timeline → Preview → Accept/Reject`

`linear-blend` is **快速預覽** only. It is not AI inbetweening.


