/** VisualAnnotation protocol. MCP returns these; the frontend renders. Never CSS/DOM commands. */

export const VISUAL_ANNOTATION_TYPES = [
  "POINT",
  "REGION",
  "PATH",
  "LABEL",
  "RANGE",
] as const;

export type VisualAnnotationType = (typeof VISUAL_ANNOTATION_TYPES)[number];

export const VISUAL_SEVERITIES = [
  "ok",
  "info",
  "warning",
  "error",
  "critical",
] as const;

export type VisualSeverity = (typeof VISUAL_SEVERITIES)[number];

export type VisualAnnotation = {
  id: string;
  frame_id?: string | null;
  frame_number: number;
  type: VisualAnnotationType;
  /** POINT [x,y]; REGION [x,y,w,h]; PATH [x,y,...]; RANGE [start,end]. All spatial coords are 0–1. */
  coordinates: number[];
  label: string;
  severity?: VisualSeverity | null;
  source: "ai" | "user" | "engine";
  linked_analysis_id?: string | null;
  category?: string | null;
};

export function isVisualAnnotation(value: unknown): value is VisualAnnotation {
  if (!value || typeof value !== "object") return false;
  const v = value as VisualAnnotation;
  return (
    typeof v.id === "string" &&
    typeof v.frame_number === "number" &&
    (VISUAL_ANNOTATION_TYPES as readonly string[]).includes(v.type) &&
    Array.isArray(v.coordinates) &&
    typeof v.label === "string"
  );
}

export function pointAnnotation(
  id: string,
  frame: number,
  x: number,
  y: number,
  label: string,
  extras: Partial<VisualAnnotation> = {},
): VisualAnnotation {
  return {
    id,
    frame_number: frame,
    type: "POINT",
    coordinates: [clamp01(x), clamp01(y)],
    label,
    source: extras.source ?? "engine",
    severity: extras.severity ?? "info",
    category: extras.category ?? null,
    frame_id: extras.frame_id ?? null,
    linked_analysis_id: extras.linked_analysis_id ?? null,
  };
}

export function regionAnnotation(
  id: string,
  frame: number,
  box: { x: number; y: number; w: number; h: number },
  label: string,
  extras: Partial<VisualAnnotation> = {},
): VisualAnnotation {
  return {
    id,
    frame_number: frame,
    type: "REGION",
    coordinates: [clamp01(box.x), clamp01(box.y), clamp01(box.w), clamp01(box.h)],
    label,
    source: extras.source ?? "engine",
    severity: extras.severity ?? "warning",
    category: extras.category ?? null,
    frame_id: extras.frame_id ?? null,
    linked_analysis_id: extras.linked_analysis_id ?? null,
  };
}

export function rangeAnnotation(
  id: string,
  start: number,
  end: number,
  label: string,
  extras: Partial<VisualAnnotation> = {},
): VisualAnnotation {
  return {
    id,
    frame_number: extras.frame_number ?? start,
    type: "RANGE",
    coordinates: [start, end],
    label,
    source: extras.source ?? "engine",
    severity: extras.severity ?? "warning",
    category: extras.category ?? null,
    linked_analysis_id: extras.linked_analysis_id ?? null,
  };
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function toNormalized(
  x: number,
  y: number,
  frameWidth: number,
  frameHeight: number,
): { x: number; y: number } {
  if (x >= 0 && x <= 1 && y >= 0 && y <= 1) return { x, y };
  return {
    x: clamp01(x / Math.max(1, frameWidth)),
    y: clamp01(y / Math.max(1, frameHeight)),
  };
}

export function fromNormalized(
  x: number,
  y: number,
  frameWidth: number,
  frameHeight: number,
): { x: number; y: number } {
  return { x: x * frameWidth, y: y * frameHeight };
}

const CATEGORY_LABEL: Record<string, string> = {
  FACE: "臉",
  HAND: "手",
  BODY: "身體",
  CHARACTER_IDENTITY: "角色",
  CHARACTER_STABILITY: "角色",
  OBJECT: "物件",
  OBJECT_STABILITY: "物件",
  BACKGROUND: "背景",
  CONTACT: "接觸",
  CONTACT_CONTINUITY: "接觸",
  MOTION: "運動",
  MOTION_CONTINUITY: "運動",
  POSE: "姿態",
  POSE_CONTINUITY: "姿態",
  TRACKING_CONTINUITY: "追蹤",
  TEMPORAL_FLICKER: "閃爍",
  CAMERA: "相機",
};

export function categoryLabel(category?: string | null): string {
  if (!category) return "問題";
  return CATEGORY_LABEL[category] ?? "問題";
}

export type ProblemLocator = (p: {
  peak: number;
  category?: string | null;
}) => { x: number; y: number; w: number; h: number } | null;

export function annotationsFromProblems(
  problems: {
    start?: number;
    end?: number;
    peak_frame?: number;
    frame_number?: number;
    category?: string;
    severity?: string;
    reason?: string;
  }[],
  locate?: ProblemLocator,
): VisualAnnotation[] {
  const out: VisualAnnotation[] = [];
  problems.forEach((p, i) => {
    const start = p.start ?? p.frame_number ?? 0;
    const end = p.end ?? p.frame_number ?? start;
    const peak = p.peak_frame ?? start;
    const label = `${categoryLabel(p.category)} · ${p.reason ?? "問題"}`;
    const severity = (p.severity as VisualSeverity) || "warning";
    out.push(
      rangeAnnotation(`rng-${i}-${start}-${end}`, start, end, label, {
        severity,
        category: p.category,
        frame_number: peak,
        source: "engine",
      }),
    );
    const box = locate?.({ peak, category: p.category });
    if (box) {
      out.push(
        regionAnnotation(`reg-${i}-${peak}`, peak, box, label, {
          severity,
          category: p.category,
          source: "engine",
        }),
      );
      out.push(
        pointAnnotation(`pt-${i}-${peak}`, peak, box.x + box.w / 2, box.y + 0.02, label, {
          severity,
          category: p.category,
          source: "engine",
        }),
      );
    }
  });
  return out;
}

export function mapAiAnnotation(raw: unknown): VisualAnnotation | null {
  if (!isVisualAnnotation(raw)) return null;
  return {
    ...raw,
    coordinates: raw.coordinates.map((n) => (typeof n === "number" ? n : 0)),
  };
}
