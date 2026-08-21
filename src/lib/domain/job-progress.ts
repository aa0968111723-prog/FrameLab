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
      ? `${stage.current} / ${stage.total} 格`
      : null;
  const running = state === "running" || state === "queued";
  if (running && type === "FRAME_EXTRACTION") {
    return frames ? `拆幀 ${frames}` : `拆幀 ${progress}%`;
  }
  if (running && type === "OPTICAL_FLOW") {
    return frames ? `分析運動 ${frames}` : `分析運動 ${progress}%`;
  }
  if (running && type === "POSE_ANALYSIS") {
    return frames ? `分析姿態 ${frames}` : `分析姿態 ${progress}%`;
  }
  if (running && type === "POINT_TRACKING") {
    return frames ? `分析追蹤 ${frames}` : `分析追蹤 ${progress}%`;
  }
  if (running && type === "SEGMENTATION") {
    return frames ? `SAM 2 遮罩 ${frames}` : `SAM 2 遮罩 ${progress}%`;
  }
  if (running && type === "CONSISTENCY_ANALYSIS") {
    return frames ? `評估一致性 ${frames}` : `評估一致性 ${progress}%`;
  }
  if (running && type === "REPAIR_INTERPOLATION") {
    return frames ? `修復插值 ${frames}` : `修復插值 ${progress}%`;
  }
  if (running && type === "GENERATIVE_REPAIR") {
    return "區域生成修復";
  }
  if (stage?.label && running) return stage.label;
  return `${jobTypeZh(type)} · ${jobStateZh(state)} · ${progress}%`;
}

export function jobTypeZh(type: string) {
  switch (type) {
    case "GENERATE_INBETWEENS":
      return "產生中間影格";
    case "FRAME_EXTRACTION":
      return "拆幀";
    case "VIDEO_INGEST":
      return "匯入影片";
    case "OPTICAL_FLOW":
      return "運動分析";
    case "POSE_ANALYSIS":
      return "姿態分析";
    case "POINT_TRACKING":
      return "點追蹤";
    case "SEGMENTATION":
      return "SAM 2 遮罩";
    case "CONSISTENCY_ANALYSIS":
      return "一致性";
    case "REPAIR_INTERPOLATION":
      return "修復插值";
    case "GENERATIVE_REPAIR":
      return "區域生成修復";
    default:
      return "工作";
  }
}

export function jobStateZh(state: string) {
  if (state === "running") return "進行中";
  if (state === "queued") return "排隊中";
  if (state === "done" || state === "succeeded" || state === "completed") return "完成";
  if (state === "failed") return "失敗";
  if (state === "cancelled") return "已取消";
  return "狀態";
}
