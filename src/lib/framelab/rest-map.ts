export type RestMapping = {
  tool: string;
  args: Record<string, unknown>;
  bodyKeys?: string[];
};

/** Map /api/v1 REST paths from the spec onto executeTool names. */
export function mapRestPath(
  method: string,
  pathname: string,
  query: Record<string, string>,
): RestMapping | null {
  const raw = pathname.replace(/.*\/api\/v1\/?/, "").replace(/\/$/, "");
  const parts = raw.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  const m = method.toUpperCase();

  if (parts[0] === "projects" && parts.length === 1 && m === "GET") {
    return { tool: "list_projects", args: {} };
  }
  if (parts[0] === "projects" && parts.length === 1 && m === "POST") {
    return { tool: "create_project", args: {} };
  }
  if (parts[0] === "projects" && parts.length === 2 && m === "GET") {
    return { tool: "get_project", args: { projectId: parts[1] } };
  }
  if (parts[0] === "videos" && parts.length === 1 && m === "GET") {
    return { tool: "list_videos", args: { projectId: query.projectId } };
  }
  if (parts[0] === "videos" && parts.length === 2 && m === "GET") {
    return { tool: "get_video", args: { videoId: parts[1] } };
  }
  if (parts[0] === "videos" && parts.length === 3 && parts[2] === "extract" && m === "POST") {
    return { tool: "extract_video", args: { videoId: parts[1] } };
  }
  if (parts[0] === "graph" && parts.length === 1 && m === "GET") {
    return { tool: "get_graph", args: { projectId: query.projectId } };
  }
  if (parts[0] === "characters" && parts.length === 1 && m === "GET") {
    return { tool: "list_characters", args: { projectId: query.projectId } };
  }
  if (parts[0] === "timelines" && parts.length === 2 && m === "GET") {
    return { tool: "get_timeline", args: { timelineId: parts[1] } };
  }
  if (parts[0] === "frames" && parts.length === 1 && m === "GET") {
    return {
      tool: "get_frame_range",
      args: {
        timelineId: query.timelineId,
        startFrame: Number(query.startFrame ?? 0),
        endFrame: Number(query.endFrame ?? 0),
      },
    };
  }
  if (parts[0] === "frames" && parts.length === 2 && m === "GET") {
    return { tool: "get_frame", args: { frameId: parts[1] } };
  }
  if (parts[0] === "frames" && parts.length === 3 && parts[2] === "analysis" && m === "GET") {
    return { tool: "get_frame_analysis", args: { frameId: parts[1] } };
  }
  if (parts[0] === "frames" && parts.length === 3 && parts[2] === "neighbors" && m === "GET") {
    return { tool: "get_frame_neighbors", args: { frameId: parts[1] } };
  }
  if (parts[0] === "frames" && parts.length === 3 && parts[2] === "analyze" && m === "POST") {
    return { tool: "analyze_frame", args: { frameId: parts[1] } };
  }
  if (parts[0] === "frames" && parts.length === 2 && parts[1] === "analyze-range" && m === "POST") {
    return { tool: "analyze_frame_range", args: {} };
  }
  if (parts[0] === "keyframes" && parts.length === 2 && parts[1] === "range" && m === "POST") {
    return { tool: "create_keyframe_range", args: {} };
  }
  if (parts[0] === "keyframes" && m === "POST") {
    return { tool: "create_keyframe", args: {} };
  }
  if (parts[0] === "keyframes" && parts.length === 2 && m === "DELETE") {
    return { tool: "remove_keyframe", args: { frameId: parts[1] } };
  }
  if (parts[0] === "undo" && m === "POST") {
    return { tool: "undo", args: {} };
  }
  if (parts[0] === "redo" && m === "POST") {
    return { tool: "redo", args: {} };
  }
  if (parts[0] === "interpolate" && m === "POST") {
    return { tool: "interpolate_frames", args: {} };
  }
  if (parts[0] === "tracking" && parts[1] === "analyze" && m === "POST") {
    return { tool: "analyze_tracking", args: {} };
  }
  if (parts[0] === "motion" && parts[1] === "recalculate" && m === "POST") {
    return { tool: "recalculate_motion", args: {} };
  }
  if (parts[0] === "repair" && parts[1] === "region" && m === "POST") {
    return { tool: "regenerate_region", args: {} };
  }
  if (parts[0] === "repair" && parts[1] === "frame" && m === "POST") {
    return { tool: "repair_frame", args: {} };
  }
  if (parts[0] === "repair" && parts[1] === "range" && m === "POST") {
    return { tool: "repair_frame_range", args: {} };
  }
  if (parts[0] === "render" && m === "POST") {
    return { tool: "render_animation", args: {} };
  }
  if (parts[0] === "jobs" && parts.length === 1 && m === "GET") {
    return { tool: "list_jobs", args: { projectId: query.projectId } };
  }
  if (parts[0] === "jobs" && parts.length === 2 && m === "GET") {
    return { tool: "get_job", args: { jobId: parts[1] } };
  }
  if (parts[0] === "jobs" && parts.length === 3 && parts[2] === "cancel" && m === "POST") {
    return { tool: "cancel_job", args: { jobId: parts[1] } };
  }
  if (parts[0] === "models" && parts.length === 2 && parts[1] === "status" && m === "GET") {
    return { tool: "get_model_status", args: {} };
  }
  if (parts[0] === "models" && m === "GET") {
    return { tool: "get_model_status", args: {} };
  }
  if (parts[0] === "system" && parts[1] === "devices" && m === "GET") {
    return { tool: "get_model_status", args: {} };
  }
  if (parts[0] === "keyframes" && parts.length === 1 && m === "GET") {
    return { tool: "get_keyframes", args: { timelineId: query.timelineId } };
  }
  if (parts[0] === "characters" && parts.length === 2 && m === "GET") {
    return { tool: "get_character", args: { characterId: parts[1] } };
  }
  if (parts[0] === "characters" && parts.length === 3 && parts[2] === "track" && m === "GET") {
    return { tool: "get_character_track", args: { characterId: parts[1] } };
  }
  if (parts[0] === "objects" && parts.length === 2 && m === "GET") {
    return { tool: "get_object", args: { objectId: parts[1] } };
  }
  if (parts[0] === "objects" && parts.length === 3 && parts[2] === "track" && m === "GET") {
    return { tool: "get_object_track", args: { objectId: parts[1] } };
  }
  if (parts[0] === "sessions" && parts.length === 3 && parts[2] === "context" && m === "GET") {
    return { tool: "get_current_context", args: { sessionId: parts[1] } };
  }
  if (parts[0] === "sessions" && parts.length === 3 && parts[2] === "frame" && m === "GET") {
    return { tool: "get_current_frame", args: { sessionId: parts[1] } };
  }
  if (parts[0] === "sessions" && parts.length === 3 && parts[2] === "frames" && m === "GET") {
    return { tool: "get_selected_frames", args: { sessionId: parts[1] } };
  }
  if (parts[0] === "sessions" && parts.length === 3 && parts[2] === "range" && m === "GET") {
    return { tool: "get_selected_range", args: { sessionId: parts[1] } };
  }
  if (parts[0] === "sessions" && parts.length === 3 && parts[2] === "region" && m === "GET") {
    return { tool: "get_selected_region", args: { sessionId: parts[1] } };
  }
  if (parts[0] === "sessions" && parts.length === 3 && parts[2] === "character" && m === "GET") {
    return { tool: "get_current_character", args: { sessionId: parts[1] } };
  }
  if (parts[0] === "sessions" && parts.length === 3 && parts[2] === "object" && m === "GET") {
    return { tool: "get_current_object", args: { sessionId: parts[1] } };
  }
  if (parts[0] === "analysis" && parts[1] === "motion" && m === "POST") {
    return { tool: "analyze_motion", args: {} };
  }
  if (parts[0] === "analysis" && parts[1] === "pose" && m === "POST") {
    return { tool: "analyze_pose", args: {} };
  }
  if (parts[0] === "analysis" && parts[1] === "tracking" && m === "POST") {
    return { tool: "analyze_tracking", args: {} };
  }
  if (parts[0] === "analysis" && parts[1] === "consistency" && m === "POST") {
    return { tool: "analyze_consistency", args: {} };
  }
  if (parts[0] === "problem-ranges" && m === "GET") {
    return { tool: "get_problem_ranges", args: { timelineId: query.timelineId } };
  }
  if (parts[0] === "repair-plans" && parts.length === 1 && m === "POST") {
    return { tool: "create_repair_plan", args: {} };
  }
  if (parts[0] === "repair-plans" && parts.length === 2 && m === "GET") {
    return { tool: "get_repair_plan", args: { planId: parts[1] } };
  }
  if (parts[0] === "repair-plans" && parts.length === 3 && parts[2] === "execute" && m === "POST") {
    return { tool: "execute_repair_plan", args: { planId: parts[1] } };
  }
  if (parts[0] === "revisions" && parts.length === 3 && parts[2] === "restore" && m === "POST") {
    return { tool: "restore_revision", args: { revisionId: parts[1] } };
  }
  if (parts[0] === "revisions" && parts.length === 3 && parts[2] === "compare" && m === "GET") {
    return { tool: "compare_before_after", args: { revisionId: parts[1] } };
  }
  if (parts[0] === "context" && m === "GET") {
    return { tool: "get_current_context", args: { sessionId: query.sessionId } };
  }
  if (parts[0] === "analyze" && parts[1] === "selection" && m === "POST") {
    return { tool: "analyze_selection", args: { sessionId: query.sessionId ?? query.context_id } };
  }
  if (parts[0] === "analyze" && parts[1] === "motion-context" && m === "POST") {
    return { tool: "analyze_motion_context", args: { sessionId: query.sessionId } };
  }
  if (parts[0] === "compare" && parts[1] === "frames" && m === "POST") {
    return { tool: "compare_frames", args: {} };
  }
  if (parts[0] === "keyframe-pairs" && parts.length === 1 && m === "POST") {
    return { tool: "create_keyframe_pair", args: {} };
  }
  if (parts[0] === "keyframe-pairs" && parts.length === 2 && m === "GET") {
    return { tool: "get_keyframe_pair", args: { pairId: parts[1] } };
  }
  if (parts[0] === "keyframe-pairs" && parts.length === 3 && parts[2] === "analyze" && m === "POST") {
    return { tool: "analyze_keyframe_transition", args: { pairId: parts[1] } };
  }
  if (parts[0] === "motion-plans" && parts.length === 1 && m === "POST") {
    return { tool: "create_motion_plan", args: {} };
  }
  if (parts[0] === "motion-plans" && parts.length === 2 && m === "GET") {
    return { tool: "get_motion_plan", args: { planId: parts[1] } };
  }
  if (parts[0] === "inbetweens" && parts[1] === "plan" && m === "POST") {
    return { tool: "create_inbetween_plan", args: {} };
  }
  if (parts[0] === "inbetweens" && parts[1] === "generate" && m === "POST") {
    return { tool: "generate_inbetweens", args: {} };
  }
  if (parts[0] === "inbetweens" && parts[1] === "jobs" && parts.length === 3 && m === "GET") {
    return { tool: "get_generation_job", args: { jobId: parts[2] } };
  }
  if (parts[0] === "candidates" && parts.length === 1 && m === "GET") {
    return { tool: "list_candidates", args: { timelineId: query.timelineId } };
  }
  if (parts[0] === "candidates" && parts.length === 2 && m === "GET") {
    return { tool: "get_candidate", args: { candidateId: parts[1] } };
  }
  if (parts[0] === "inbetweens" && parts.length === 3 && parts[2] === "evaluate" && m === "POST") {
    return { tool: "evaluate_inbetweens", args: { candidateId: parts[1] } };
  }
  if (parts[0] === "inbetweens" && parts.length === 3 && parts[2] === "regenerate" && m === "POST") {
    return { tool: "regenerate_inbetween_range", args: { candidateId: parts[1] } };
  }
  if (parts[0] === "inbetweens" && parts.length === 3 && parts[2] === "accept" && m === "POST") {
    return { tool: "accept_generated_frames", args: { candidateId: parts[1] } };
  }
  if (parts[0] === "inbetweens" && parts.length === 3 && parts[2] === "reject" && m === "POST") {
    return { tool: "reject_generated_frames", args: { candidateId: parts[1] } };
  }
  if (parts[0] === "export" && (parts[1] === "sequence" || parts[1] === "png") && m === "POST") {
    return { tool: "export_frame_sequence", args: {} };
  }
  if (parts[0] === "breakdowns" && parts[1] === "suggest" && m === "POST") {
    return { tool: "suggest_breakdown_frames", args: {} };
  }
  if (parts[0] === "breakdowns" && m === "POST") {
    return { tool: "create_breakdown", args: {} };
  }
  if (parts[0] === "visual" && parts[1] === "context" && m === "GET") {
    return { tool: "get_visual_context", args: { timelineId: query.timelineId, frameNumber: Number(query.frameNumber ?? 0) } };
  }
  if (parts[0] === "visual" && parts[1] === "annotate" && m === "POST") {
    return { tool: "annotate_frame", args: {} };
  }
  if (parts[0] === "visual" && parts[1] === "region" && m === "POST") {
    return { tool: "highlight_region", args: {} };
  }
  if (parts[0] === "visual" && parts[1] === "range" && m === "POST") {
    return { tool: "highlight_frame_range", args: {} };
  }
  if (parts[0] === "visual" && parts[1] === "motion-path" && m === "GET") {
    return { tool: "get_motion_path", args: { projectId: query.projectId, name: query.name } };
  }
  if (parts[0] === "visual" && parts[1] === "pose" && m === "GET") {
    return { tool: "get_pose_overlay", args: { timelineId: query.timelineId, frameNumber: Number(query.frameNumber ?? 0) } };
  }
  if (parts[0] === "visual" && parts[1] === "tracking" && m === "GET") {
    return { tool: "get_tracking_overlay", args: { projectId: query.projectId } };
  }
  if (parts[0] === "visual" && parts[1] === "problems" && m === "GET") {
    return { tool: "get_problem_regions", args: { timelineId: query.timelineId } };
  }
  if (parts[0] === "visual" && parts[1] === "focus" && m === "POST") {
    return { tool: "focus_problem", args: {} };
  }
  if (parts[0] === "visual" && parts[1] === "compare" && m === "POST") {
    return { tool: "compare_frames_visual", args: {} };
  }
  return null;
}
