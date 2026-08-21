import { rtmposeHealth } from "@/lib/ai/rtmpose-worker";
import { locotrackHealth } from "@/lib/ai/locotrack-worker";

export type ProviderStatus =
  | "ready"
  | "unavailable"
  | "research-only"
  | "not_implemented";

export type ModelInfo = {
  id: string;
  provider: string;
  modelName: string;
  modelVersion: string;
  checkpoint: string;
  license: string;
  commercialUse: boolean;
  device: "cpu" | "cuda" | "mps" | "api";
  precision: string;
  status: ProviderStatus;
  role:
    | "segmentation"
    | "pose"
    | "optical_flow"
    | "point_tracking"
    | "depth"
    | "vision_language"
    | "interpolation"
    | "generative_repair"
    | "metrics";
  notes: string;
};

export function listModels(): ModelInfo[] {
  const grokReady = Boolean(
    typeof process !== "undefined" && process.env.XAI_API_KEY,
  );
  return [
    {
      id: "framelab-pose-lite",
      provider: "framelab",
      modelName: "pose-lite",
      modelVersion: "0.2",
      checkpoint: "none",
      license: "Apache-2.0",
      commercialUse: true,
      device: "cpu",
      precision: "fp32",
      status: "ready",
      role: "pose",
      notes:
        "Silhouette extrema from pixel mass / frame difference. Real CPU inference. Not RTMPose.",
    },
    {
      id: "framelab-ncc",
      provider: "framelab",
      modelName: "ncc-tracker",
      modelVersion: "0.1",
      checkpoint: "none",
      license: "Apache-2.0",
      commercialUse: true,
      device: "cpu",
      precision: "fp32",
      status: "ready",
      role: "point_tracking",
      notes:
        "Normalized cross-correlation template tracker. Real inference. Not LocoTrack.",
    },
    {
      id: "block-match-16",
      provider: "framelab",
      modelName: "block-match-16",
      modelVersion: "0.1",
      checkpoint: "none",
      license: "Apache-2.0",
      commercialUse: true,
      device: "cpu",
      precision: "fp32",
      status: "ready",
      role: "optical_flow",
      notes: "16×16 SAD block matching. Honest substitute for SEA-RAFT until a checkpoint is loaded.",
    },
    {
      id: "pixel-metrics",
      provider: "framelab",
      modelName: "pixel-metrics",
      modelVersion: "0.1",
      checkpoint: "none",
      license: "Apache-2.0",
      commercialUse: true,
      device: "cpu",
      precision: "fp32",
      status: "ready",
      role: "metrics",
      notes:
        "Histogram, MAE difference, luma flicker, 16x16 block matching. Always on.",
    },
    {
      id: "linear-blend",
      provider: "framelab",
      modelName: "linear-blend",
      modelVersion: "0.1",
      checkpoint: "none",
      license: "Apache-2.0",
      commercialUse: true,
      device: "cpu",
      precision: "fp32",
      status: "ready",
      role: "interpolation",
      notes: "Per-pixel linear blend with motion curves. Not RIFE.",
    },
    {
      id: "grok-vlm",
      provider: "xai",
      modelName: "grok-4.5",
      modelVersion: "latest",
      checkpoint: "api",
      license: "xAI API",
      commercialUse: true,
      device: "api",
      precision: "api",
      status: grokReady ? "ready" : "unavailable",
      role: "vision_language",
      notes:
        "User-initiated analysis of selected / key / suspicious frames only. Never run on every frame.",
    },
    {
      id: "qwen2.5-vl",
      provider: "qwen",
      modelName: "qwen2.5-vl",
      modelVersion: "unwired",
      checkpoint: "none",
      license: "check checkpoint",
      commercialUse: false,
      device: "cuda",
      precision: "fp16",
      status: "unavailable",
      role: "vision_language",
      notes:
        "Spec adapter reserved. v0.1 uses Grok vision when XAI_API_KEY is set. MODEL_NOT_AVAILABLE.",
    },
    {
      id: "tensorrt",
      provider: "nvidia",
      modelName: "tensorrt",
      modelVersion: "unwired",
      checkpoint: "none",
      license: "NVIDIA",
      commercialUse: true,
      device: "cuda",
      precision: "fp16",
      status: "unavailable",
      role: "metrics",
      notes: "TensorRTProvider reserved. Not required in v0.1.",
    },
    {
      id: "sam2",
      provider: "meta",
      modelName: "sam2",
      modelVersion: "unwired",
      checkpoint: "none",
      license: "Apache-2.0 (code) / check checkpoint",
      commercialUse: true,
      device: "cpu",
      precision: "fp16",
      status: "unavailable",
      role: "segmentation",
      notes: "Adapter reserved. MODEL_NOT_AVAILABLE until a checkpoint is loaded.",
    },
    {
      id: "rtmpose",
      provider: "openmmlab",
      modelName: "rtmpose-s",
      modelVersion: "simcc-body7",
      checkpoint: "rtmpose-s_simcc-body7 + yolox-tiny",
      license: "Apache-2.0",
      commercialUse: true,
      device: rtmposeHealth().device,
      precision: "fp32",
      status: rtmposeHealth().ok ? "ready" : "unavailable",
      role: "pose",
      notes:
        "Real RTMPose ONNX via Python worker (YOLOX-tiny detector). pose-lite is the basic fallback only.",
    },
    {
      id: "sea-raft",
      provider: "sea-raft",
      modelName: "sea-raft",
      modelVersion: "unwired",
      checkpoint: "none",
      license: "check checkpoint",
      commercialUse: false,
      device: "cuda",
      precision: "fp16",
      status: "unavailable",
      role: "optical_flow",
      notes: "Adapter reserved. Use block-match-16. Not a fake SEA-RAFT result.",
    },
    {
      id: "locotrack",
      provider: "cvlab-kaist",
      modelName: "locotrack-s",
      modelVersion: "eccv2024",
      checkpoint: "locotrack_small.ckpt",
      license: "Apache-2.0",
      commercialUse: true,
      device: locotrackHealth().device,
      precision: "fp32",
      status: locotrackHealth().ok ? "ready" : "unavailable",
      role: "point_tracking",
      notes: "Real LocoTrack-S via Python worker. Click canvas to track. Statuses: visible / occluded / lost / recovered.",
    },
    {
      id: "video-depth-anything",
      provider: "depth-anything",
      modelName: "video-depth-anything-small",
      modelVersion: "unwired",
      checkpoint: "none",
      license: "check checkpoint",
      commercialUse: false,
      device: "cuda",
      precision: "fp16",
      status: "unavailable",
      role: "depth",
      notes: "Adapter reserved. Not defaulted — commercial use may be restricted.",
    },
    {
      id: "rife",
      provider: "rife",
      modelName: "rife",
      modelVersion: "unwired",
      checkpoint: "none",
      license: "MIT (code) / check checkpoint",
      commercialUse: true,
      device: "cuda",
      precision: "fp16",
      status: "unavailable",
      role: "interpolation",
      notes: "Reserved. Use linear-blend until a RIFE checkpoint is registered.",
    },
    {
      id: "wan",
      provider: "wan",
      modelName: "wan",
      modelVersion: "unwired",
      checkpoint: "none",
      license: "check checkpoint",
      commercialUse: false,
      device: "cuda",
      precision: "fp16",
      status: "unavailable",
      role: "generative_repair",
      notes: "Reserved. Generative inbetween / repair returns PROVIDER_NOT_AVAILABLE. Not the default.",
    },
    {
      id: "fal.ai",
      provider: "fal.ai",
      modelName: "fal-inbetween",
      modelVersion: "unwired",
      checkpoint: "none",
      license: "check provider",
      commercialUse: true,
      device: "api",
      precision: "api",
      status: "unavailable",
      role: "generative_repair",
      notes: "Reserved adapter. MODEL_NOT_AVAILABLE. No fake frames.",
    },
    {
      id: "comfyui",
      provider: "comfyui",
      modelName: "comfyui-inbetween",
      modelVersion: "unwired",
      checkpoint: "none",
      license: "check workflow",
      commercialUse: true,
      device: "cuda",
      precision: "fp16",
      status: "unavailable",
      role: "generative_repair",
      notes: "Reserved ComfyUI adapter. PROVIDER_NOT_AVAILABLE until a workflow is registered.",
    },
  ];
}

export function getDeviceInfo() {
  const pose = rtmposeHealth();
  return {
    cpu: true,
    cuda: pose.cuda === true,
    mps: false,
    gpu: pose.cuda ? "cuda" : null,
    vram_gb: 0,
    runtime: pose.ok ? "python+node" : "node",
    rtmpose: pose,
    note: pose.ok
      ? `RTMPose worker ready on ${pose.device}. Other CUDA adapters remain reserved.`
      : "RTMPose worker not loaded. Pixel metrics, NCC, block-match, linear blend, and xAI vision run on CPU/API.",
  };
}

export const DeviceManager = {
  getInfo: getDeviceInfo,
};
