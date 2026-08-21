/** Human-readable job stage labels (spec §59). */

export type JobStageInfo = {
  current?: number;
  total?: number;
  label?: string;
};

export function parseJobStage(resultJson?: string | null): JobStageInfo | null {
  if (!resultJson) return null;
  try {
    const parsed = JSON.parse(resultJson) as JobStageInfo & { stage?: JobStageInfo | string };
    if (typeof parsed.stage === "string") return { label: parsed.stage };
    if (parsed.stage) return parsed.stage;
    if (parsed.current != null || parsed.label) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function jobStageLabel(
  type: string,
  state: string,
  progress: number,
  stage?: JobStageInfo | null,
): string {
  if (stage?.label && (state === "running" || state === "queued")) return stage.label;
  if (type === "GENERATE_INBETWEENS" && (state === "running" || state === "queued")) {
    if (progress < 15) return "正在分析關鍵影格…";
    if (progress < 30) return "正在建立動作計畫…";
    if (progress < 70) return `正在產生影格… ${progress}%`;
    if (progress < 90) return "正在評估產生的影格…";
    if (progress < 100) return "正在檢查一致性…";
  }
  const frames =
    stage?.current != null && stage?.total != null
      ? `${stage.current} / ${stage.total} frames`
      : null;
  const running = state === "running" || state === "queued";
  if (running && type === "OPTICAL_FLOW") {
    return frames ? `分析運動 ${frames}` : `分析運動 ${progress}%`;
  }
  if (running && type === "POSE_ANALYSIS") {
    return frames ? `分析姿態 ${frames}` : `分析姿態 ${progress}%`;
  }
  if (running && type === "POINT_TRACKING") {
    return frames ? `分析追蹤 ${frames}` : `分析追蹤 ${progress}%`;
  }
  if (running && type === "CONSISTENCY_ANALYSIS") {
    return frames ? `評估一致性 ${frames}` : `評估一致性 ${progress}%`;
  }
  if (running && type === "REPAIR_INTERPOLATION") {
    return frames ? `修復插值 ${frames}` : `修復插值 ${progress}%`;
  }
  if (stage?.label && running) return stage.label;
  return `${type} · ${state} · ${progress}%`;
}
