# Tracking

**LocoTrack-S** is the real tracker:

`Canvas click → create_tracking_point → POINT_TRACKING job → locotrack_worker.py → LocoTrack-S → tracking_points → trail overlay`

Statuses: `visible` / `occluded` / `lost` / `recovered`.

`framelab-ncc` remains a template-matching fallback (`provider=framelab-ncc`).
