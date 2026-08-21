export type { Scope } from "./types.ts";
import type { Scope } from "./types.ts";
import { FrameLabError } from "./errors.ts";

const HIGH_RISK = new Set([
  "delete_frame",
  "replace_frame",
  "repair_frame_range",
  "regenerate_region",
  "render_overwrite",
  "extract_video",
  "ingest_frames",
  "execute_repair_plan",
  "restore_revision",
  "generate_inbetweens",
  "regenerate_inbetween_range",
  "accept_generated_frames",
  "generate_breakdown_frame",
]);

export const TOOL_SCOPES: Record<string, Scope> = {
  list_projects: "READ",
  get_project: "READ",
  create_project: "EDIT",
  get_video: "READ",
  list_videos: "READ",
  get_timeline: "READ",
  get_frame: "READ",
  get_frame_range: "READ",
  get_frame_window: "READ",
  get_motion_between: "READ",
  get_keyframes: "READ",
  get_character: "READ",
  get_character_track: "READ",
  get_object: "READ",
  get_object_track: "READ",
  get_consistency_results: "READ",
  get_problem_frames: "READ",
  get_job: "READ",
  list_jobs: "READ",
  get_model_status: "READ",
  restore_revision: "EDIT",
  list_revisions: "READ",
  analyze_frame: "ANALYZE",
  analyze_frame_range: "ANALYZE",
  analyze_pose: "ANALYZE",
  analyze_motion: "ANALYZE",
  analyze_tracking: "ANALYZE",
  analyze_consistency: "ANALYZE",
  detect_problem_frames: "ANALYZE",
  detect_keyframes: "ANALYZE",
  compare_frames: "ANALYZE",
  create_keyframe: "EDIT",
  remove_keyframe: "EDIT",
  lock_keyframe: "EDIT",
  unlock_keyframe: "EDIT",
  mark_breakdown: "EDIT",
  duplicate_frame: "EDIT",
  add_frame: "EDIT",
  insert_frame: "EDIT",
  clear_frame: "EDIT",
  hold_frame: "EDIT",
  create_breakdown: "EDIT",
  edit_pose: "EDIT",
  list_pose_constraints: "READ",
  edit_motion_path: "EDIT",
  list_motion_constraints: "READ",
  replace_frame: "EDIT",
  delete_frame: "EDIT",
  set_frame_duration: "EDIT",
  set_frame_type: "EDIT",
  set_frame_notes: "EDIT",
  set_onion_skin: "EDIT",
  create_character: "EDIT",
  assign_character: "EDIT",
  assign_character_range: "EDIT",
  set_character_visibility: "EDIT",
  list_characters: "READ",
  list_objects: "READ",
  create_object: "EDIT",
  assign_object: "EDIT",
  create_tracking_point: "EDIT",
  get_graph: "READ",
  get_frame_analysis: "READ",
  get_frame_neighbors: "READ",
  get_current_context: "READ",
  get_current_frame: "READ",
  get_selected_frames: "READ",
  get_selected_frame_range: "READ",
  get_selected_range: "READ",
  get_selected_region: "READ",
  get_current_character: "READ",
  get_current_object: "READ",
  analyze_selection: "ANALYZE",
  analyze_motion_context: "ANALYZE",
  mark_inbetween: "EDIT",
  create_keyframe_range: "EDIT",
  undo: "EDIT",
  redo: "EDIT",
  list_audit_logs: "ADMIN",
  create_sample_project: "EDIT",
  ingest_frames: "EDIT",
  generate_inbetweens: "GENERATE",
  interpolate_frames: "GENERATE",
  repair_frame: "GENERATE",
  repair_frame_range: "GENERATE",
  regenerate_region: "GENERATE",
  rerun_tracking: "ANALYZE",
  rerun_motion: "ANALYZE",
  recalculate_motion: "ANALYZE",
  rerun_consistency: "ANALYZE",
  extract_video: "EDIT",
  render_preview: "RENDER",
  render_frame_range: "RENDER",
  render_animation: "RENDER",
  cancel_job: "EDIT",
  list_mcp_clients: "ADMIN",
  get_problem_ranges: "READ",
  create_repair_plan: "SUGGEST",
  suggest_repair: "SUGGEST",
  compare_before_after: "READ",
  execute_repair_plan: "EDIT",
  get_repair_plan: "READ",
  accept_revision: "EDIT",
  get_track: "READ",
  retrack_range: "ANALYZE",
  create_track: "EDIT",
  create_keyframe_pair: "EDIT",
  get_keyframe_pair: "READ",
  analyze_keyframe_transition: "ANALYZE",
  create_motion_plan: "SUGGEST",
  get_motion_plan: "READ",
  suggest_breakdown_frames: "SUGGEST",
  create_inbetween_plan: "SUGGEST",
  get_generation_job: "READ",
  get_candidate: "READ",
  list_candidates: "READ",
  evaluate_inbetweens: "ANALYZE",
  get_generated_issues: "READ",
  regenerate_inbetween_range: "GENERATE",
  accept_generated_frames: "EDIT",
  reject_generated_frames: "EDIT",
  export_frame_sequence: "RENDER",
  generate_breakdown_frame: "GENERATE",
  get_generated_frame: "READ",
  set_frame_exposure: "EDIT",
  set_playback_fps: "EDIT",
  get_visual_context: "READ",
  annotate_frame: "SUGGEST",
  highlight_region: "SUGGEST",
  highlight_frame_range: "SUGGEST",
  get_motion_path: "READ",
  get_pose_overlay: "READ",
  get_tracking_overlay: "READ",
  get_problem_regions: "READ",
  focus_problem: "READ",
  compare_frames_visual: "ANALYZE",
  list_visual_annotations: "READ",
};

export function parseScopes(raw: string | string[]): Scope[] {
  const parts = Array.isArray(raw) ? raw : raw.split(/[,\s]+/);
  const set = new Set<Scope>();
  for (const p of parts) {
    const s = p.trim().toUpperCase();
    if (
      s === "READ" ||
      s === "ANALYZE" ||
      s === "SUGGEST" ||
      s === "EDIT" ||
      s === "GENERATE" ||
      s === "RENDER" ||
      s === "ADMIN"
    ) {
      set.add(s);
    }
  }
  return [...set];
}

export function hasScope(granted: Scope[], needed: Scope): boolean {
  if (granted.includes("ADMIN")) return true;
  if (granted.includes(needed)) return true;
  if (needed === "READ") {
    return granted.some((s) => s !== "READ");
  }
  if (needed === "SUGGEST") {
    return granted.some((s) => s === "ANALYZE" || s === "EDIT" || s === "GENERATE");
  }
  return false;
}

export function assertToolAllowed(granted: Scope[], tool: string): void {
  const needed = TOOL_SCOPES[tool];
  if (!needed) {
    throw new FrameLabError("MCP_TOOL_ERROR", `Unknown tool: ${tool}`, 400);
  }
  if (!hasScope(granted, needed)) {
    throw new FrameLabError(
      "PERMISSION_DENIED",
      `Tool ${tool} requires scope ${needed}`,
      403,
      { tool, needed, granted },
    );
  }
}

export function isHighRisk(tool: string): boolean {
  return HIGH_RISK.has(tool);
}

export function requireConfirmedEdit(tool: string, args: Record<string, unknown>): void {
  if (args.confirmed === true || args.confirm === true) return;
  throw new FrameLabError(
    "PERMISSION_DENIED",
    `${tool} requires confirmed=true after an explicit UI confirmation. ASSIST cannot set this flag.`,
    403,
    { tool },
  );
}

export function assertProjectScope(projectScope: string | undefined, projectId: string): void {
  if (!projectScope || projectScope === "all") return;
  const allowed = projectScope
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowed.includes(projectId)) {
    throw new FrameLabError(
      "PERMISSION_DENIED",
      "MCP token is not allowed to access this project",
      403,
      { projectId, projectScope },
    );
  }
}
