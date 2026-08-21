import { fail } from "@/lib/domain/errors";
import { applyCurve } from "@/lib/domain/motion-curve";
import { nccTrack, type TrackedPoint } from "@/lib/domain/ncc-tracker";
import { blendRgba, motionField, motionGrid, type RegionBox, type RgbaFrame } from "@/lib/domain/pixel-metrics";
import { cropRgba } from "@/lib/domain/lightweight-analysis";
import type { MotionCurve } from "@/lib/domain/types";
import { estimatePoseLite, type PoseEstimate } from "@/lib/domain/pose-lite";
import { encodeJpegBuffer } from "@/lib/domain/image-codec";
import { rtmposeAvailable, rtmposeHealth, runRtmposeBatch, toPoseEstimate } from "@/lib/ai/rtmpose-worker";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { InbetweenCapabilities } from "@/lib/domain/animation-constraints";
import type { MotionPlan } from "@/lib/domain/motion-plan";
import { linearBlendCapabilities, reservedGenerativeCapabilities } from "@/lib/domain/inbetween-strategy";

export type ProviderMeta = {
  name: string;
  version: string;
  status: "ready" | "MODEL_NOT_AVAILABLE" | "PROVIDER_NOT_AVAILABLE" | "GPU_REQUIRED";
  device: "cpu" | "cuda" | "api";
  capabilities: string[];
};

export async function healthCheck(p: {
  id: string;
  available: () => boolean;
  device?: "cpu" | "cuda" | "api";
  capabilities?: string[];
}): Promise<ProviderMeta> {
  const ready = p.available();
  return {
    name: p.id,
    version: "0.2",
    status: ready ? "ready" : "MODEL_NOT_AVAILABLE",
    device: p.device ?? "cpu",
    capabilities: ready ? (p.capabilities ?? ["infer"]) : [],
  };
}

export type ProviderRun<T> =
  | { ok: true; data: T; provider: string }
  | { ok: false; code: "MODEL_NOT_AVAILABLE" | "PROVIDER_NOT_AVAILABLE"; error: string; provider: string };

function unavailable(
  provider: string,
  kind: "MODEL_NOT_AVAILABLE" | "PROVIDER_NOT_AVAILABLE" = "MODEL_NOT_AVAILABLE",
): never {
  fail(
    kind,
    `${provider} adapter is reserved and not loaded. No fake ${provider} result.`,
  );
}

export interface SegmentationProvider {
  readonly id: string;
  available(): boolean;
  health_check(): Promise<ProviderMeta>;
  segment(frame: RgbaFrame): Promise<ProviderRun<unknown>>;
}

export interface PoseProvider {
  readonly id: string;
  available(): boolean;
  health_check(): Promise<ProviderMeta>;
  estimate(frame: RgbaFrame, frameNumber?: number): Promise<ProviderRun<PoseEstimate | unknown>>;
}

export interface OpticalFlowProvider {
  readonly id: string;
  available(): boolean;
  health_check(): Promise<ProviderMeta>;
  flow(a: RgbaFrame, b: RgbaFrame, region?: RegionBox | null): Promise<ProviderRun<{
    magnitude: number;
    direction: number;
    grid: { x: number; y: number; dx: number; dy: number; mag: number }[];
    region?: RegionBox | null;
  }>>;
}

export interface PointTrackingProvider {
  readonly id: string;
  available(): boolean;
  health_check(): Promise<ProviderMeta>;
  track(input: {
    frames: RgbaFrame[];
    seed: { x: number; y: number; frameIndex: number };
    patch?: number;
    search?: number;
    minScore?: number;
  }): Promise<ProviderRun<TrackedPoint[]>>;
}


export interface DepthProvider {
  readonly id: string;
  available(): boolean;
  health_check(): Promise<ProviderMeta>;
  depth(frame: RgbaFrame): Promise<ProviderRun<unknown>>;
}

export interface VisionLanguageProvider {
  readonly id: string;
  available(): boolean;
  health_check(): Promise<ProviderMeta>;
}

export interface InterpolationProvider {
  readonly id: string;
  available(): boolean;
  health_check(): Promise<ProviderMeta>;
  interpolate(
    a: RgbaFrame,
    b: RgbaFrame,
    count: number,
    config: { curve: MotionCurve; region?: RegionBox | null },
  ): Promise<RgbaFrame[]>;
}

export interface GenerativeRepairProvider {
  readonly id: string;
  available(): boolean;
  health_check(): Promise<ProviderMeta>;
  repair(): Promise<ProviderRun<unknown>>;
  generateBetween(): Promise<ProviderRun<unknown>>;
  regenerateRegion(): Promise<ProviderRun<unknown>>;
}

class Reserved implements
  SegmentationProvider,
  PoseProvider,
  OpticalFlowProvider,
  PointTrackingProvider,
  DepthProvider,
  GenerativeRepairProvider {
  readonly id: string;
  private readonly kind: "MODEL_NOT_AVAILABLE" | "PROVIDER_NOT_AVAILABLE";
  constructor(
    id: string,
    kind: "MODEL_NOT_AVAILABLE" | "PROVIDER_NOT_AVAILABLE" = "MODEL_NOT_AVAILABLE",
  ) {
    this.id = id;
    this.kind = kind;
  }
  available() {
    return false;
  }
  health_check() {
    return healthCheck(this);
  }
  async segment(_frame?: RgbaFrame): Promise<ProviderRun<unknown>> {
    unavailable(this.id, this.kind);
  }
  async estimate(_frame?: RgbaFrame): Promise<ProviderRun<unknown>> {
    unavailable(this.id, this.kind);
  }
  async flow(_a?: RgbaFrame, _b?: RgbaFrame, _region?: RegionBox | null): Promise<ProviderRun<{
    magnitude: number;
    direction: number;
    grid: { x: number; y: number; dx: number; dy: number; mag: number }[];
    region?: RegionBox | null;
  }>> {
    unavailable(this.id, this.kind);
  }
  async track(_input?: {
    frames: RgbaFrame[];
    seed: { x: number; y: number; frameIndex: number };
  }): Promise<ProviderRun<TrackedPoint[]>> {
    unavailable(this.id, this.kind);
  }

  async depth(_frame?: RgbaFrame): Promise<ProviderRun<unknown>> {
    unavailable(this.id, this.kind);
  }
  async repair(): Promise<ProviderRun<unknown>> {
    unavailable(this.id, this.kind);
  }
  async generateBetween(): Promise<ProviderRun<unknown>> {
    unavailable(this.id, this.kind);
  }
  async regenerateRegion(): Promise<ProviderRun<unknown>> {
    unavailable(this.id, "PROVIDER_NOT_AVAILABLE");
  }
}

export class LinearBlendInterpolation implements InterpolationProvider {
  readonly id = "linear-blend";
  available() {
    return true;
  }
  health_check() {
    return healthCheck(this);
  }
  async interpolate(
    a: RgbaFrame,
    b: RgbaFrame,
    count: number,
    config: { curve: MotionCurve; region?: RegionBox | null },
  ): Promise<RgbaFrame[]> {
    void config.region; // FULL_FRAME_INTERPOLATION — region reserved, not faked
    const out: RgbaFrame[] = [];
    for (let i = 1; i <= count; i += 1) {
      const u = applyCurve(i / (count + 1), config.curve);
      out.push(blendRgba(a, b, u));
    }
    return out;
  }
}

export class RifeInterpolation implements InterpolationProvider {
  readonly id = "rife";
  available() {
    return false;
  }
  health_check() {
    return healthCheck(this);
  }
  async interpolate(): Promise<RgbaFrame[]> {
    fail("PROVIDER_NOT_AVAILABLE", "RIFE is not loaded. Use provider=linear-blend.");
  }
}

export const sam2: SegmentationProvider = new Reserved("sam2");
export const seaRaft: OpticalFlowProvider = new Reserved("sea-raft");
export const locotrack: PointTrackingProvider = new Reserved("locotrack");
export const videoDepthAnything: DepthProvider = new Reserved("video-depth-anything");
export const rife = new RifeInterpolation();
export const wan: GenerativeRepairProvider = new Reserved("wan", "PROVIDER_NOT_AVAILABLE");
export const linearBlend = new LinearBlendInterpolation();

export class QwenVisionProvider implements VisionLanguageProvider {
  readonly id = "qwen2.5-vl";
  available() {
    return false;
  }
  health_check() {
    return healthCheck(this);
  }
}

export class TensorRTProvider {
  readonly id = "tensorrt";
  available() {
    return false;
  }
  async run(): Promise<never> {
    fail(
      "MODEL_NOT_AVAILABLE",
      "TensorRTProvider is reserved. v0.1 does not require TensorRT.",
    );
  }
}

export const qwenVl: VisionLanguageProvider = new QwenVisionProvider();
export const tensorrt = new TensorRTProvider();

export class NccPointTracker implements PointTrackingProvider {
  readonly id = "framelab-ncc";
  available() {
    return true;
  }
  health_check() {
    return healthCheck(this);
  }
  async track(input: {
    frames: RgbaFrame[];
    seed: { x: number; y: number; frameIndex: number };
    patch?: number;
    search?: number;
    minScore?: number;
  }): Promise<ProviderRun<TrackedPoint[]>> {
    const data = nccTrack(input.frames, input.seed, input);
    return { ok: true, data, provider: this.id };
  }
}

export class BlockMatchFlow implements OpticalFlowProvider {
  readonly id = "block-match-16";
  available() {
    return true;
  }
  health_check() {
    return healthCheck(this);
  }
  async flow(
    a: RgbaFrame,
    b: RgbaFrame,
    region?: RegionBox | null,
  ): Promise<
    ProviderRun<{
      magnitude: number;
      direction: number;
      grid: { x: number; y: number; dx: number; dy: number; mag: number }[];
      region?: RegionBox | null;
    }>
  > {
    const fa = region ? cropRgba(a, region) : a;
    const fb = region ? cropRgba(b, region) : b;
    const summary = motionField(fa, fb);
    return {
      ok: true,
      data: { ...summary, grid: motionGrid(fa, fb), region: region ?? null },
      provider: this.id,
    };
  }
}

export const nccTracker = new NccPointTracker();
export const blockMatchFlow = new BlockMatchFlow();

export class PoseLiteProvider implements PoseProvider {
  readonly id = "framelab-pose-lite";
  available() {
    return true;
  }
  health_check() {
    return healthCheck(this);
  }
  async estimate(frame: RgbaFrame, frameNumber = 0): Promise<ProviderRun<PoseEstimate>> {
    return {
      ok: true,
      data: estimatePoseLite(frame, frameNumber),
      provider: this.id,
    };
  }
}

export const poseLite = new PoseLiteProvider();

export class RtmposeProvider implements PoseProvider {
  readonly id = "rtmpose";
  available() {
    return rtmposeAvailable();
  }
  health_check(): Promise<ProviderMeta> {
    const h = rtmposeHealth();
    return Promise.resolve({
      name: this.id,
      version: "rtmpose-s",
      status: h.ok ? "ready" : "MODEL_NOT_AVAILABLE",
      device: h.device,
      capabilities: h.ok ? ["pose", "coco17"] : [],
    });
  }
  async estimate(frame: RgbaFrame, frameNumber = 0): Promise<ProviderRun<PoseEstimate>> {
    if (!this.available()) {
      return {
        ok: false,
        code: "MODEL_NOT_AVAILABLE",
        error: "RTMPose worker is not loaded.",
        provider: this.id,
      };
    }
    const dir = path.join(tmpdir(), "framelab-rtmpose");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `one-${frameNumber}-${Date.now()}.jpg`);
    writeFileSync(file, encodeJpegBuffer(frame, 90));
    try {
      const { poses } = await runRtmposeBatch([
        { id: `frm-${frameNumber}`, path: file, frameNumber, width: frame.width, height: frame.height },
      ]);
      const first = poses[0];
      if (!first) {
        return { ok: false, code: "MODEL_NOT_AVAILABLE", error: "empty RTMPose result", provider: this.id };
      }
      return { ok: true, data: toPoseEstimate(first), provider: this.id };
    } finally {
      try {
        rmSync(file, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

export const rtmpose = new RtmposeProvider();
export const mmpose = rtmpose;

export interface InbetweenProvider {
  readonly id: string;
  readonly kind: "interpolation" | "generative";
  available(): boolean;
  health_check(): Promise<ProviderMeta>;
  capabilities(): InbetweenCapabilities;
  generate(input: {
    start: RgbaFrame;
    end: RgbaFrame;
    count: number;
    motionPlan: MotionPlan;
    constraints?: MotionPlan["constraints"];
    characterRefs?: { id: string; name: string; image?: string }[];
    objectRefs?: { id: string; name: string; image?: string }[];
    config?: { seed?: number; quality?: "preview" | "production" };
  }): Promise<RgbaFrame[]>;
}

export class LinearBlendInbetween implements InbetweenProvider {
  readonly id = "linear-blend";
  readonly kind = "interpolation" as const;
  available() {
    return true;
  }
  health_check() {
    return healthCheck({ id: this.id, available: () => this.available() });
  }
  capabilities() {
    return linearBlendCapabilities();
  }
  async generate(input: {
    start: RgbaFrame;
    end: RgbaFrame;
    count: number;
    motionPlan: MotionPlan;
  }): Promise<RgbaFrame[]> {
    const out: RgbaFrame[] = [];
    const spacing = input.motionPlan.spacing;
    for (let i = 0; i < input.count; i += 1) {
      const u = spacing[i] ?? applyCurve((i + 1) / (input.count + 1), input.motionPlan.curve);
      out.push(blendRgba(input.start, input.end, u));
    }
    return out;
  }
}

export class WanInbetween implements InbetweenProvider {
  readonly id = "wan";
  readonly kind = "generative" as const;
  available() {
    return false;
  }
  health_check() {
    return healthCheck({ id: this.id, available: () => this.available() });
  }
  capabilities() {
    return reservedGenerativeCapabilities();
  }
  async generate(): Promise<RgbaFrame[]> {
    fail("PROVIDER_NOT_AVAILABLE", "Wan generative inbetween is not loaded. Use provider=linear-blend.");
  }
}

export class FalInbetween implements InbetweenProvider {
  readonly id = "fal.ai";
  readonly kind = "generative" as const;
  available() {
    return false;
  }
  health_check() {
    return healthCheck({ id: this.id, available: () => this.available() });
  }
  capabilities() {
    return reservedGenerativeCapabilities();
  }
  async generate(): Promise<RgbaFrame[]> {
    fail("MODEL_NOT_AVAILABLE", "fal.ai inbetween adapter is reserved. No fake frames.");
  }
}

export class ComfyInbetween implements InbetweenProvider {
  readonly id = "comfyui";
  readonly kind = "generative" as const;
  available() {
    return false;
  }
  health_check() {
    return healthCheck({ id: this.id, available: () => this.available() });
  }
  capabilities() {
    return reservedGenerativeCapabilities();
  }
  async generate(): Promise<RgbaFrame[]> {
    fail("PROVIDER_NOT_AVAILABLE", "ComfyUI inbetween adapter is reserved. No fake frames.");
  }
}

export const linearBlendInbetween = new LinearBlendInbetween();
export const wanInbetween = new WanInbetween();
export const falInbetween = new FalInbetween();
export const comfyInbetween = new ComfyInbetween();

export function getInbetween(provider: string): InbetweenProvider {
  if (provider === "linear-blend" || provider === "auto" || provider === "framelab") return linearBlendInbetween;
  if (provider === "rife") {
    return {
      id: "rife",
      kind: "interpolation",
      available: () => false,
      health_check: () => healthCheck({ id: "rife", available: () => false }),
      capabilities: () => linearBlendCapabilities(),
      generate: async () => {
        fail("PROVIDER_NOT_AVAILABLE", "RIFE is not loaded. Use provider=linear-blend.");
      },
    };
  }
  if (provider === "wan") return wanInbetween;
  if (provider === "fal.ai" || provider === "fal") return falInbetween;
  if (provider === "comfyui" || provider === "comfy") return comfyInbetween;
  fail("PROVIDER_NOT_AVAILABLE", `Inbetween provider '${provider}' is not loaded.`);
}

export function getInterpolation(provider: string): InterpolationProvider {
  if (provider === "linear-blend" || provider === "framelab") return linearBlend;
  if (provider === "rife") return rife;
  fail("PROVIDER_NOT_AVAILABLE", `Interpolation provider '${provider}' is not loaded.`);
}

export function getPointTracker(provider: string): PointTrackingProvider {
  if (provider === "framelab-ncc" || provider === "ncc" || provider === "framelab") {
    return nccTracker;
  }
  if (provider === "locotrack") return locotrack;
  fail("PROVIDER_NOT_AVAILABLE", `Point tracking provider '${provider}' is not loaded.`);
}

export function getOpticalFlow(provider: string): OpticalFlowProvider {
  if (provider === "block-match-16" || provider === "framelab" || provider === "block-match") {
    return blockMatchFlow;
  }
  if (provider === "sea-raft") return seaRaft;
  fail("PROVIDER_NOT_AVAILABLE", `Optical flow provider '${provider}' is not loaded.`);
}

export function getPose(provider: string): PoseProvider {
  if (
    provider === "framelab-pose-lite" ||
    provider === "pose-lite" ||
    provider === "framelab" ||
    provider === "default"
  ) {
    return poseLite;
  }
  if (provider === "rtmpose" || provider === "mmpose") return rtmpose;
  fail("PROVIDER_NOT_AVAILABLE", `Pose provider '${provider}' is not loaded.`);
}

