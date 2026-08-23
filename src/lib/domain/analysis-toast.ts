/**
 * Toast copy for analyze_motion / analyze_pose.
 * The backend stores the provider that actually ran (sea-raft vs block-match-16,
 * rtmpose vs pose-lite). The UI used to toast the tool name, so a CPU fallback
 * was announced as SEA-RAFT / RTMPose.
 */

const CPU_FALLBACK = new Set([
  "block-match-16",
  "block-match",
  "framelab",
  "framelab-pose-lite",
  "pose-lite",
  "framelab-ncc",
]);

export function providerFromPayload(payload: string | Record<string, unknown> | null | undefined): string | null {
  if (payload == null || payload === "") return null;
  let data: unknown = payload;
  if (typeof payload === "string") {
    try {
      data = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;
  const p = (data as { provider?: unknown }).provider;
  return typeof p === "string" && p.trim() ? p.trim() : null;
}

export function isCpuFallbackProvider(provider: string): boolean {
  const id = provider.toLowerCase();
  if (CPU_FALLBACK.has(id)) return true;
  if (id.includes("block-match")) return true;
  if (id.includes("pose-lite")) return true;
  return false;
}

export function analysisDoneToast(
  tool: string,
  payload?: string | Record<string, unknown> | null,
): string {
  const provider = providerFromPayload(payload ?? null);
  const kind = tool === "analyze_pose" ? "骨架" : "光流";
  if (!provider) return `${kind}已寫入`;
  if (isCpuFallbackProvider(provider)) {
    return `${provider} ${kind}已寫入（非 AI／CPU 近似）`;
  }
  if (tool === "analyze_motion" && provider === "sea-raft") return "SEA-RAFT 光流已寫入";
  if (tool === "analyze_pose" && provider === "rtmpose") return "RTMPose 骨架已寫入";
  return `${provider} ${kind}已寫入`;
}
