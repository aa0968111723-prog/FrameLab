export const WORKSPACE_MODES = ["ANIMATE", "ANALYZE", "REPAIR", "REVIEW", "GENERATE"] as const;
export type WorkspaceMode = (typeof WORKSPACE_MODES)[number];

export const OVERLAY_IDS = [
  "original",
  "onion",
  "pose",
  "motion",
  "track",
  "mask",
  "problems",
  "compare",
  "heatmap",
  "flow",
  "diff",
] as const;

export type OverlayId = (typeof OVERLAY_IDS)[number];

export type OverlayStack = {
  primary: OverlayId;
  extras: OverlayId[];
};

export const MODE_BAR: { id: OverlayId; label: string }[] = [
  { id: "original", label: "原圖" },
  { id: "onion", label: "洋蔥皮" },
  { id: "pose", label: "骨架" },
  { id: "motion", label: "動作" },
  { id: "track", label: "追蹤" },
  { id: "mask", label: "遮罩" },
  { id: "problems", label: "問題" },
  { id: "compare", label: "比較" },
];

export const COMPARE_MODES = ["flicker", "side", "overlay", "diff", "hold"] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

export function defaultOverlayForMode(mode: WorkspaceMode): OverlayStack {
  switch (mode) {
    case "ANALYZE":
      return { primary: "problems", extras: ["onion"] };
    case "REPAIR":
      return { primary: "mask", extras: ["problems"] };
    case "REVIEW":
      return { primary: "original", extras: ["onion"] };
    case "GENERATE":
      return { primary: "onion", extras: [] };
    default:
      return { primary: "original", extras: [] };
  }
}

/** Spec §58: original + 1 main overlay + problem markers. Never dump every layer. */
export function activeOverlays(stack: OverlayStack, problemsAlways = true): Set<OverlayId> {
  const set = new Set<OverlayId>(["original", stack.primary, ...stack.extras]);
  if (problemsAlways) set.add("problems");
  if (stack.primary === "onion") set.add("onion");
  return set;
}

export function toggleExtra(stack: OverlayStack, id: OverlayId): OverlayStack {
  if (stack.primary === id) return stack;
  const has = stack.extras.includes(id);
  return {
    ...stack,
    extras: has ? stack.extras.filter((x) => x !== id) : [...stack.extras, id].slice(0, 3),
  };
}

export function setPrimary(stack: OverlayStack, id: OverlayId): OverlayStack {
  return { primary: id, extras: stack.extras.filter((x) => x !== id) };
}

export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2] as const;

export const TRAIL_TARGETS = [
  "head",
  "left_hand",
  "right_hand",
  "hip",
  "foot",
  "object",
  "custom",
] as const;

export type TrailTarget = (typeof TRAIL_TARGETS)[number];

export const TRAIL_LABEL: Record<TrailTarget, string> = {
  head: "頭",
  left_hand: "左手",
  right_hand: "右手",
  hip: "髖",
  foot: "腳",
  object: "物件",
  custom: "自訂",
};

export function trailKeypointNames(target: TrailTarget): string[] {
  switch (target) {
    case "head":
      return ["nose"];
    case "left_hand":
      return ["left_wrist"];
    case "right_hand":
      return ["right_wrist"];
    case "hip":
      return ["left_hip", "right_hip"];
    case "foot":
      return ["left_ankle", "right_ankle"];
    default:
      return [];
  }
}

export const PROBLEM_FILTERS = [
  "All",
  "Character",
  "Face",
  "Hand",
  "Motion",
  "Object",
  "Contact",
  "Background",
] as const;

export type ProblemFilter = (typeof PROBLEM_FILTERS)[number];

export const PROBLEM_FILTER_LABEL: Record<ProblemFilter, string> = {
  All: "全部",
  Character: "角色",
  Face: "臉",
  Hand: "手",
  Motion: "運動",
  Object: "物件",
  Contact: "接觸",
  Background: "背景",
};

export function matchesProblemFilter(category: string | undefined, filter: ProblemFilter): boolean {
  if (filter === "All" || !category) return filter === "All" || !category;
  const c = category.toUpperCase();
  if (filter === "Character") return c.includes("CHARACTER") || c === "BODY";
  if (filter === "Face") return c.includes("FACE");
  if (filter === "Hand") return c.includes("HAND");
  if (filter === "Motion") return c.includes("MOTION") || c.includes("POSE") || c.includes("FLICKER");
  if (filter === "Object") return c.includes("OBJECT");
  if (filter === "Contact") return c.includes("CONTACT");
  if (filter === "Background") return c.includes("BACKGROUND") || c.includes("CAMERA");
  return true;
}

export function chromeForMode(mode: WorkspaceMode, focus: boolean) {
  const review = mode === "REVIEW" || focus;
  return {
    left: !review,
    right: !review,
    ai: !focus,
    onionPeek: mode === "ANIMATE" || mode === "ANALYZE" || mode === "REVIEW",
    regionActions: mode === "REPAIR" || mode === "ANALYZE",
    generateStory: mode === "GENERATE",
    repairWindow: mode === "REPAIR",
  };
}
