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
    if (progress < 15) return "Analyzing keyframes...";
    if (progress < 30) return "Creating motion plan...";
    if (progress < 70) return `Generating frames... ${progress}%`;
    if (progress < 90) return "Evaluating generated frames...";
    if (progress < 100) return "Checking consistency...";
  }
  const frames =
    stage?.current != null && stage?.total != null
      ? `${stage.current} / ${stage.total} frames`
      : null;
  const running = state === "running" || state === "queued";
  if (running && type === "OPTICAL_FLOW") {
    return frames ? `Analyzing Motion ${frames}` : `Analyzing Motion ${progress}%`;
  }
  if (running && type === "POSE_ANALYSIS") {
    return frames ? `Analyzing Pose ${frames}` : `Analyzing Pose ${progress}%`;
  }
  if (running && type === "POINT_TRACKING") {
    return frames ? `Analyzing Tracking ${frames}` : `Analyzing Tracking ${progress}%`;
  }
  if (running && type === "CONSISTENCY_ANALYSIS") {
    return frames ? `Evaluating Consistency ${frames}` : `Evaluating Consistency ${progress}%`;
  }
  if (running && type === "REPAIR_INTERPOLATION") {
    return frames ? `Repair interpolation ${frames}` : `Repair interpolation ${progress}%`;
  }
  if (stage?.label && running) return stage.label;
  return `${type} · ${state} · ${progress}%`;
}
