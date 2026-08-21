# AI models

Adapters live in `src/lib/ai/providers.ts` + the registry. Core commands never import a checkpoint path.

**Ready**

- `pixel-metrics` — MAE, 16-bin histogram, luma flicker, block matching
- `framelab-ncc` — NCC template point tracker (`PointTrackingProvider`). Real inference.
- `block-match-16` — 16×16 SAD optical flow CPU fallback (`OpticalFlowProvider`). Not SEA-RAFT.
- `linear-blend` — 快速預覽 (pixel blend). Not AI inbetweening.
- `rife` — Practical-RIFE 4.25 Python worker
- `region-blend` — bbox-only paste of neighbor interpolation (`regenerate_region` with `x,y,w,h`)
- `ffmpeg` — frame extraction (`spawn` argv, no shell)
- `grok-4.5` — vision, user-initiated, `XAI_API_KEY` (`ExternalAIProvider`)
- `rtmpose` — RTMPose-s + YOLOX-tiny Python worker
- `locotrack` — LocoTrack-S Python worker
- `sea-raft` — SEA-RAFT-S Python worker (two-frame optical flow)
- `sam2` — SAM 2.1 hiera-tiny Python worker (click mask + forward/backward propagate)


**Unavailable (honest errors)**

Video Depth Anything Small (`DepthProvider`), Wan (`GenerativeRepairProvider`), Qwen2.5-VL (spec VLM — v0.1 uses Grok instead), TensorRT (reserved).

Adding a provider: implement the interface, register status `ready` only after a real inference test writes to the database.
