# AI models

Adapters live in `src/lib/ai/providers.ts` + the registry. Core commands never import a checkpoint path.

**Ready**

- `pixel-metrics` — MAE, 16-bin histogram, luma flicker, block matching
- `framelab-ncc` — NCC template point tracker (`PointTrackingProvider`). Real inference.
- `block-match-16` — 16×16 SAD optical flow (`OpticalFlowProvider`). Real inference. Not SEA-RAFT.
- `linear-blend` — per-pixel blend + motion curve (`InterpolationProvider`)
- `region-blend` — bbox-only paste of neighbor interpolation (`regenerate_region` with `x,y,w,h`)
- `ffmpeg` — frame extraction (`spawn` argv, no shell)
- `grok-4.5` — vision, user-initiated, `XAI_API_KEY` (`ExternalAIProvider`)


**Unavailable (honest errors)**

SAM 2 (`SegmentationProvider`), RTMPose (`PoseProvider`), SEA-RAFT (`OpticalFlowProvider`), LocoTrack (`PointTrackingProvider`), Video Depth Anything Small (`DepthProvider`), RIFE (`InterpolationProvider`), Wan (`GenerativeRepairProvider`), Qwen2.5-VL (spec VLM — v0.1 uses Grok instead), TensorRT (reserved).

Adding a provider: implement the interface, register status `ready` only after a real inference test writes to the database.
