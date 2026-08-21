export const MCP_RESOURCES = [
  { uri: "framelab://projects", name: "Projects", mimeType: "application/json" },
  { uri: "framelab://models", name: "Models", mimeType: "application/json" },
  { uri: "framelab://system/status", name: "System status", mimeType: "application/json" },
];

export const MCP_RESOURCE_TEMPLATES = [
  { uriTemplate: "framelab://projects/{project_id}", name: "Project" },
  { uriTemplate: "framelab://videos/{video_id}", name: "Video" },
  { uriTemplate: "framelab://timelines/{timeline_id}", name: "Timeline" },
  { uriTemplate: "framelab://frames/{frame_id}", name: "Frame" },
  { uriTemplate: "framelab://frames/{frame_id}/analysis", name: "Frame analysis" },
  { uriTemplate: "framelab://frames/{frame_id}/neighbors", name: "Frame neighbors" },
  { uriTemplate: "framelab://characters/{character_id}", name: "Character" },
  { uriTemplate: "framelab://characters/{character_id}/track", name: "Character track" },
  { uriTemplate: "framelab://objects/{object_id}", name: "Object" },
  { uriTemplate: "framelab://objects/{object_id}/track", name: "Object track" },
  { uriTemplate: "framelab://jobs/{job_id}", name: "Job" },
  { uriTemplate: "framelab://sessions/{session_id}/context", name: "Workspace session context" },
  { uriTemplate: "framelab://session/{session_id}/context", name: "Workspace session context (alias)" },
  { uriTemplate: "framelab://conversations/{conversation_id}", name: "Conversation" },
  { uriTemplate: "framelab://keyframe-pairs/{id}", name: "Keyframe pair" },
  { uriTemplate: "framelab://motion-plans/{id}", name: "Motion plan" },
  { uriTemplate: "framelab://generation-jobs/{id}", name: "Generation job" },
  { uriTemplate: "framelab://candidates/{id}", name: "Candidate timeline version" },
  { uriTemplate: "framelab://generated-frames/{id}", name: "Generated frame" },
];

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    name,
    description,
    inputSchema: { type: "object", properties, required },
  };
}

const str = { type: "string" };
const num = { type: "number" };
const bool = { type: "boolean" };

export const MCP_TOOLS = [
  tool("list_projects", "List projects for the authenticated client", {}),
  tool("get_project", "Get a project", { projectId: str }, ["projectId"]),
  tool("create_project", "Create an empty project + timeline. Default playback fps is 24.", { name: str, fps: num }),
  tool("get_video", "Get a video record", { videoId: str }, ["videoId"]),
  tool("list_videos", "List videos in a project", { projectId: str }, ["projectId"]),
  tool("get_timeline", "Get a timeline and frame metadata", { timelineId: str }, ["timelineId"]),
  tool("get_frame", "Get a single frame (includes image)", { frameId: str, timelineId: str, frameNumber: num }),
  tool("get_frame_range", "Get a range of frame metadata", { timelineId: str, startFrame: num, endFrame: num }, ["timelineId", "startFrame", "endFrame"]),
  tool("get_frame_window", "Graph window around a center frame", { timelineId: str, centerFrame: num, before: num, after: num }, ["timelineId", "centerFrame"]),
  tool("get_motion_between", "Stored or derived motion between two frames", { timelineId: str, frameA: num, frameB: num }, ["timelineId", "frameA", "frameB"]),
  tool("get_keyframes", "List KEY and BREAKDOWN frames", { timelineId: str }, ["timelineId"]),
  tool("get_character", "Get a character", { characterId: str }, ["characterId"]),
  tool("get_character_track", "Frames a character appears in", { characterId: str }, ["characterId"]),
  tool("get_object", "Get an object", { objectId: str }, ["objectId"]),
  tool("get_object_track", "Frames an object appears in", { objectId: str }, ["objectId"]),
  tool("get_consistency_results", "Read last consistency pass", { timelineId: str }, ["timelineId"]),
  tool("get_problem_frames", "Frames whose last consistency pass is warning/error", { timelineId: str }, ["timelineId"]),
  tool("get_job", "Get a job by id", { jobId: str }, ["jobId"]),
  tool("list_jobs", "List recent jobs", { projectId: str }),
  tool("get_model_status", "List model adapters and device info", {}),
  tool("list_revisions", "Revision history", { projectId: str, frameId: str }, ["projectId"]),
  tool("restore_revision", "Restore a frame snapshot. Audited. Requires confirmed=true from the UI.", { revisionId: str, confirmed: bool }, ["revisionId"]),
  tool("analyze_frame", "LEVEL_1 pixel analysis; set vlm=true for Grok vision (selected frames only)", { timelineId: str, frameNumber: num, frameId: str, vlm: bool, prompt: str, level: str }),
  tool("analyze_frame_range", "Pixel consistency over a range (creates a job)", { timelineId: str, startFrame: num, endFrame: num }, ["timelineId"]),
  tool("analyze_consistency", "Alias of analyze_frame_range", { timelineId: str, startFrame: num, endFrame: num }, ["timelineId"]),
  tool("analyze_motion", "SEA-RAFT-S optical flow between frames. provider=block-match-16 for CPU fallback.", { timelineId: str, startFrame: num, endFrame: num, provider: str }, ["timelineId"]),
  tool("analyze_pose", "RTMPose (YOLOX-tiny + RTMPose-s ONNX). provider=framelab-pose-lite for basic silhouette mode.", { timelineId: str, startFrame: num, endFrame: num, provider: str, sessionId: str }, ["timelineId"]),
  tool("segment_object", "SAM 2 click mask + forward/backward propagate. Low confidence is warn/lost, never a fake success.", { timelineId: str, x: num, y: num, frameNumber: num, direction: str, objectId: str, characterId: str, startFrame: num, endFrame: num }, ["timelineId", "x", "y", "frameNumber"]),
  tool("analyze_mask", "Alias of segment_object.", { timelineId: str, x: num, y: num, frameNumber: num, direction: str, objectId: str }, ["timelineId", "x", "y", "frameNumber"]),
  tool("list_segmentations", "List SAM 2 masks for a timeline.", { timelineId: str, frameNumber: num, objectId: str }, ["timelineId"]),
  tool("analyze_tracking", "LocoTrack-S across the timeline from canvas seeds. provider=framelab-ncc for template fallback.", { timelineId: str, name: str, provider: str }, ["timelineId"]),
  tool("detect_problem_frames", "Run consistency and return warning/error frames", { timelineId: str, startFrame: num, endFrame: num }, ["timelineId"]),
  tool("detect_keyframes", "Mark local-maxima of frame difference as KEY", { timelineId: str }, ["timelineId"]),
  tool("compare_frames", "MAE / histogram / block-match between two frames. Optional region (normalized or pixels). sessionId fills timeline/region from workspace context.", { timelineId: str, frameA: num, frameB: num, region: { type: "object" }, x: num, y: num, w: num, h: num, sessionId: str, session_id: str }, ["frameA", "frameB"]),
  tool("create_keyframe", "Mark a frame as KEY", { timelineId: str, frameNumber: num, frameId: str }),
  tool("remove_keyframe", "Demote a keyframe to INBETWEEN", { timelineId: str, frameNumber: num }),
  tool("lock_keyframe", "Lock a frame against destructive edits", { frameId: str, timelineId: str, frameNumber: num }),
  tool("unlock_keyframe", "Unlock a frame", { frameId: str }),
  tool("mark_breakdown", "Mark a frame as BREAKDOWN", { timelineId: str, frameNumber: num, frameId: str }),
  tool("duplicate_frame", "Insert a HOLD copy after the frame. Writes a revision.", { frameId: str }, ["frameId"]),
  tool("add_frame", "Append a blank frame after the playhead. Writes a revision.", { timelineId: str, frameNumber: num }, ["timelineId"]),
  tool("insert_frame", "Insert a blank frame at the playhead (shifts current right). Writes a revision.", { timelineId: str, frameNumber: num }, ["timelineId"]),
  tool("clear_frame", "Wipe the current frame to blank paper. Writes a revision.", { frameId: str }, ["frameId"]),
  tool("hold_frame", "Mark the current frame as HOLD (停格, exposure ≥ 2). Writes a revision.", { frameId: str }, ["frameId"]),
  tool("create_breakdown", "Create a BREAKDOWN between keyframe A/B. mode=blank | copy | mark. copyFrom=start|end. Never generative. Writes a revision.", { timelineId: str, startFrame: num, endFrame: num, frameA: num, frameB: num, frameNumber: num, mode: str, copyFrom: str, frameType: str }, ["timelineId", "startFrame", "endFrame"]),
  tool("edit_pose", "Drag a skeleton joint. Writes PoseConstraint + revision. Does not modify the frame image.", { timelineId: str, frameNumber: num, frameId: str, joint: str, x: num, y: num, keypoints: { type: "array" } }, ["timelineId", "joint"]),
  tool("list_pose_constraints", "List PoseConstraints for a timeline or frame.", { timelineId: str, frameNumber: num }, ["timelineId"]),
  tool("edit_motion_path", "Drag one motion-path control point. Writes MotionConstraint + revision. Does not modify pixels or keyframes.", { timelineId: str, frameNumber: num, name: str, x: num, y: num }, ["timelineId", "name", "frameNumber"]),
  tool("list_motion_constraints", "List MotionConstraints for a project or trail.", { projectId: str, name: str, frameNumber: num }, ["projectId"]),
  tool("replace_frame", "Replace frame image (base64 JPEG). High-risk, audited.", { frameId: str, imageData: str }, ["frameId", "imageData"]),
  tool("delete_frame", "Delete a frame. High-risk, audited, restorable.", { frameId: str }, ["frameId"]),
  tool("set_frame_duration", "Set hold duration in milliseconds", { frameId: str, durationMs: num }, ["frameId", "durationMs"]),
  tool("set_frame_type", "Set KEY | BREAKDOWN | INBETWEEN | HOLD | GENERATED | REPAIRED", { frameId: str, frameType: str }, ["frameId", "frameType"]),
  tool("set_frame_notes", "Set frame notes", { frameId: str, notes: str }, ["frameId", "notes"]),
  tool("set_onion_skin", "Record onion-skin prefs (UI-owned; stored as no-op ack)", { enabled: bool, prev: num, next: num }),
  tool("create_character", "Create a character on a project", { projectId: str, name: str }, ["projectId", "name"]),
  tool("assign_character", "Attach a character to a frame", { frameId: str, characterId: str }, ["frameId", "characterId"]),
  tool("assign_character_range", "Attach a character to every frame in [start,end]", { timelineId: str, characterId: str, startFrame: num, endFrame: num }, ["timelineId", "characterId", "startFrame", "endFrame"]),
  tool("set_character_visibility", "visible | occluded on a frame (lost/recovered are derived from gaps)", { frameId: str, characterId: str, visible: bool, occluded: bool }, ["frameId", "characterId"]),
  tool("list_characters", "List characters in a project", { projectId: str }, ["projectId"]),
  tool("list_objects", "List objects in a project", { projectId: str }, ["projectId"]),
  tool("create_object", "Create an object on a project", { projectId: str, name: str }, ["projectId", "name"]),
  tool("assign_object", "Attach an object to a frame", { frameId: str, objectId: str }, ["frameId", "objectId"]),
  tool("create_tracking_point", "Drop a seed. track=true (default) runs LocoTrack-S across the timeline.", { projectId: str, name: str, x: num, y: num, frameNumber: num, track: bool, provider: str }, ["projectId", "name", "x", "y", "frameNumber"]),
  tool("get_graph", "Frame Graph edges for a project", { projectId: str, edgeType: str }, ["projectId"]),
  tool("get_frame_analysis", "Last stored analysis for a frame — does not re-run models", { frameId: str }, ["frameId"]),
  tool("get_frame_neighbors", "Neighbor window around a frame — metadata and asset refs only, never 4K pixels", { frameId: str, frame_id: str, sessionId: str, session_id: str, before: num, after: num }),
  tool("get_current_context", "Serialized FrameLab workspace context for a session (session-isolated)", { sessionId: str, session_id: str }),
  tool("get_current_frame", "Current frame metadata for a workspace session (no 4K pixels)", { sessionId: str, session_id: str }),
  tool("get_selected_frames", "Selected frame numbers for a workspace session", { sessionId: str, session_id: str }),
  tool("get_selected_frame_range", "Selected frame range for a workspace session", { sessionId: str, session_id: str }),
  tool("get_selected_range", "Alias of get_selected_frame_range", { sessionId: str, session_id: str }),
  tool("get_selected_region", "Normalized region selection for a workspace session", { sessionId: str, session_id: str }),
  tool("get_current_character", "Currently selected character in a workspace session", { sessionId: str, session_id: str }),
  tool("get_current_object", "Currently selected object in a workspace session", { sessionId: str, session_id: str }),
  tool("analyze_selection", "Lightweight visual analysis of the current selection (pixel MAE / histogram / centroid — not pose)", { sessionId: str, session_id: str, analysis_types: { type: "array", items: str }, context_id: str }),
  tool("analyze_motion_context", "Lightweight motion of the selection across neighbors (16×16 block + luma centroid — not SEA-RAFT)", { sessionId: str, session_id: str, timelineId: str, startFrame: num, endFrame: num }),
  tool("mark_inbetween", "Mark a frame as INBETWEEN", { timelineId: str, frameNumber: num, frameId: str }),
  tool("create_keyframe_range", "Mark start and end of a range as KEY", { timelineId: str, startFrame: num, endFrame: num }, ["timelineId", "startFrame", "endFrame"]),
  tool("undo", "Restore the latest frame snapshot (or a given revisionId)", { projectId: str, frameId: str, revisionId: str }),
  tool("redo", "Re-apply the state undone by the last undo/restore on a frame", { projectId: str, frameId: str }, ["projectId"]),
  tool("list_audit_logs", "MCP audit log for the caller (ADMIN)", { limit: num }),
  tool("create_sample_project", "Create the 24-frame bouncing-ball study", { name: str }),
  tool("ingest_frames", "Replace a timeline with JPEG frames (base64). High-risk.", { projectId: str, name: str, fps: num, frames: { type: "array" } }),
  tool("generate_inbetweens", "GENERATE: create a candidate inbetween with RIFE. provider=linear-blend is 快速預覽 only (not AI). Requires confirmed=true. Does not write the active timeline.", { timelineId: str, frameA: num, frameB: num, startFrame: num, endFrame: num, count: num, curve: str, provider: str, confirmed: bool, preserveCharacter: bool, preserveBackground: bool, preserveFace: bool, maintainContact: bool, force: bool, quality: str, intent: str, sessionId: str }, ["timelineId"]),
  tool("interpolate_frames", "Legacy immediate-write interpolation (does not create a candidate). Prefer generate_inbetweens.", { timelineId: str, frameA: num, frameB: num, count: num, curve: str }, ["timelineId", "frameA", "frameB"]),
  tool("repair_frame", "Neighborhood blend repair. Generative method returns PROVIDER_NOT_AVAILABLE.", { frameId: str, method: str }, ["frameId"]),
  tool("repair_frame_range", "Blend-repair a range. High-risk, audited, creates a job.", { timelineId: str, startFrame: num, endFrame: num }, ["timelineId", "startFrame", "endFrame"]),
  tool("regenerate_region", "Blend only a bbox (x,y,w,h) from neighbor frames. Named regions without a bbox need SAM2 → MODEL_NOT_AVAILABLE. Generative method → PROVIDER_NOT_AVAILABLE.", { frameId: str, region: str, x: num, y: num, w: num, h: num, method: str }, ["frameId"]),
  tool("rerun_tracking", "Re-run LocoTrack-S on existing seeds. provider=framelab-ncc for template fallback.", { timelineId: str, name: str, provider: str }, ["timelineId"]),
  tool("rerun_motion", "Re-run block-matching motion (not SEA-RAFT)", { timelineId: str, provider: str }, ["timelineId"]),
  tool("recalculate_motion", "Alias of rerun_motion", { timelineId: str }, ["timelineId"]),
  tool("rerun_consistency", "Re-run pixel consistency", { timelineId: str }, ["timelineId"]),
  tool("extract_video", "FFmpeg extract from a stored source video. fps omitted/auto = source fps. playbackFps independent of extract. High-risk.", { videoId: str, fps: num, playbackFps: num }, ["videoId"]),
  tool("render_preview", "FFmpeg concat of the timeline into data/projects/{id}/renders/preview.mp4", { timelineId: str }, ["timelineId"]),
  tool("render_frame_range", "FFmpeg concat of a frame range", { timelineId: str, startFrame: num, endFrame: num }, ["timelineId"]),
  tool("render_animation", "Alias of render_preview", { timelineId: str }, ["timelineId"]),
  tool("cancel_job", "Mark a queued or running job as cancelled", { jobId: str }, ["jobId"]),
  tool("list_mcp_clients", "List MCP clients for this account (no secrets, ADMIN)", {}),
  tool("get_problem_ranges", "Merged problem ranges from last consistency/assist pass", { timelineId: str }, ["timelineId"]),
  tool("create_repair_plan", "Plan a minimal safe repair window (does not edit frames)", { timelineId: str, startFrame: num, endFrame: num, sessionId: str }, ["timelineId"]),
  tool("suggest_repair", "ASSIST suggestion: problem ranges + repair plan, no edit", { timelineId: str, startFrame: num, endFrame: num, sessionId: str }, ["timelineId"]),
  tool("compare_before_after", "Compare a revision's stored original vs current frames", { revisionId: str }, ["revisionId"]),
  tool("execute_repair_plan", "EDIT: interpolation-repair interior frames. Requires confirmed=true from UI, never from ASSIST.", { planId: str, provider: str, confirmed: bool }, ["planId"]),
  tool("get_repair_plan", "Read a stored repair plan", { planId: str }, ["planId"]),
  tool("accept_revision", "Mark a revision accepted (does not re-edit pixels)", { revisionId: str }, ["revisionId"]),
  tool("get_track", "List tracking samples for a named track", { projectId: str, name: str }, ["projectId"]),
  tool("create_track", "Alias of create_tracking_point", { projectId: str, name: str, x: num, y: num, frameNumber: num }, ["projectId", "name", "x", "y", "frameNumber"]),
  tool("retrack_range", "Alias of rerun_tracking", { timelineId: str, name: str, provider: str }, ["timelineId"]),
  tool("create_keyframe_pair", "Validate and store a keyframe pair", { timelineId: str, startFrame: num, endFrame: num, frameA: num, frameB: num, count: num }, ["timelineId"]),
  tool("get_keyframe_pair", "Read a stored keyframe pair", { pairId: str, id: str }, ["pairId"]),
  tool("analyze_keyframe_transition", "Motion/pose/similarity complexity between two keys", { timelineId: str, startFrame: num, endFrame: num, frameA: num, frameB: num }, ["timelineId"]),
  tool("create_motion_plan", "Versioned motion plan with curve, constraints, spacing", { timelineId: str, startFrame: num, endFrame: num, count: num, curve: str, preserveCharacter: bool, preserveFace: bool, preserveBackground: bool, maintainContact: bool, intent: str, pairId: str }, ["timelineId"]),
  tool("get_motion_plan", "Read a stored motion plan", { planId: str, id: str }, ["planId"]),
  tool("suggest_breakdown_frames", "Suggest breakdown positions between A/B. Does not create them. Never generative.", { timelineId: str, startFrame: num, endFrame: num }, ["timelineId"]),
  tool("create_inbetween_plan", "Pair + motion plan + confirmation card. No pixels.", { timelineId: str, startFrame: num, endFrame: num, count: num, curve: str, intent: str }, ["timelineId"]),
  tool("get_generation_job", "Read GENERATE_INBETWEENS job", { jobId: str }, ["jobId"]),
  tool("get_candidate", "Read a candidate timeline version (thumbnails + evaluation, not active timeline)", { candidateId: str, id: str }, ["candidateId"]),
  tool("list_candidates", "List recent candidate versions for a timeline", { timelineId: str }, ["timelineId"]),
  tool("evaluate_inbetweens", "Re-run consistency on a candidate", { candidateId: str }, ["candidateId"]),
  tool("get_generated_issues", "Problem frames on a candidate", { candidateId: str }, ["candidateId"]),
  tool("regenerate_inbetween_range", "GENERATE: new candidate for only the bad range. Requires confirmed=true.", { candidateId: str, confirmed: bool, curve: str }, ["candidateId"]),
  tool("accept_generated_frames", "EDIT: promote candidate to active timeline after confirmation. Creates a revision.", { candidateId: str, confirmed: bool }, ["candidateId"]),
  tool("reject_generated_frames", "Mark candidate rejected. Keeps audit metadata.", { candidateId: str }, ["candidateId"]),
  tool("export_frame_sequence", "Write PNG sequence frame_0001.png … into renders/", { timelineId: str, startFrame: num, endFrame: num }, ["timelineId"]),
  tool("generate_breakdown_frame", "GENERATE: RIFE midpoint marked GENERATED_BREAKDOWN. Requires confirmed=true. Never pretends to be a human drawing.", { timelineId: str, startFrame: num, endFrame: num, frameNumber: num, confirmed: bool }, ["timelineId", "startFrame", "endFrame"]),
  tool("get_generated_frame", "Read a generated frame slot from a candidate or timeline frame id.", { id: str, candidateId: str, frameNumber: num, frameId: str }),
  tool("set_frame_exposure", "Set exposure ticks (1=一拍一, 2=一拍二, 3=一拍三). One drawing holds N playback frames. Does not duplicate the image.", { frameId: str, exposure: num, exposure_count: num }, ["frameId"]),
  tool("set_playback_fps", "Set project playback fps (1–60). Independent of drawing exposure_count. Rewrites frame duration_ms.", { projectId: str, fps: num }, ["projectId", "fps"]),
  tool("get_visual_context", "Current visual annotations / overlays for a frame. Returns VisualAnnotation, never DOM commands.", { timelineId: str, frameNumber: num, sessionId: str }),
  tool("annotate_frame", "Create a VisualAnnotation (POINT/REGION/PATH/LABEL/RANGE) with 0–1 coordinates.", { frameNumber: num, type: str, coordinates: { type: "array", items: num }, label: str, severity: str, x: num, y: num, w: num, h: num, sessionId: str, projectId: str }),
  tool("highlight_region", "Highlight a normalized region on a frame. Frontend renders the box.", { frameNumber: num, x: num, y: num, w: num, h: num, label: str, severity: str, sessionId: str }),
  tool("highlight_frame_range", "Highlight a frame range on the timeline.", { startFrame: num, endFrame: num, label: str, severity: str, sessionId: str }),
  tool("get_motion_path", "Tracking samples for a named trail.", { projectId: str, name: str }, ["projectId"]),
  tool("get_pose_overlay", "Pose-lite keypoints for a frame (normalized 0–1).", { timelineId: str, frameNumber: num }, ["timelineId"]),
  tool("get_tracking_overlay", "NCC tracking points for overlay.", { projectId: str }, ["projectId"]),
  tool("get_problem_regions", "Problem ranges as VisualAnnotation.", { timelineId: str }, ["timelineId"]),
  tool("focus_problem", "Return the annotation + frame to focus. Frontend seeks/zooms. MCP does not control the DOM.", { timelineId: str, index: num }, ["timelineId"]),
  tool("compare_frames_visual", "Visual compare contract: side_by_side / overlay / difference / flicker.", { timelineId: str, frameA: num, frameB: num }, ["timelineId", "frameA"]),
  tool("list_visual_annotations", "Stored visual annotations for a session or project.", { projectId: str, sessionId: str }),
];

export const MCP_PROMPTS = [
  {
    name: "analyze_animation_problem",
    description: "Find unnatural motion in a frame range",
    arguments: [
      { name: "timelineId", required: true },
      { name: "startFrame", required: false },
      { name: "endFrame", required: false },
    ],
  },
  {
    name: "analyze_character_motion",
    description: "Inspect a character track then consistency",
    arguments: [
      { name: "characterId", required: true },
    ],
  },
  {
    name: "analyze_hand_consistency",
    description: "Honest: pose/hand model is unavailable; fall back to motion spikes",
    arguments: [{ name: "timelineId", required: true }],
  },
  {
    name: "analyze_object_contact",
    description: "Use tracking-point distance for CONTACT_BREAK; pose contact is reserved",
    arguments: [{ name: "timelineId", required: true }],
  },
  {
    name: "suggest_repair_window",
    description: "Run consistency and return recommended repair windows",
    arguments: [{ name: "timelineId", required: true }],
  },
  {
    name: "repair_animation_range",
    description: "Call repair_frame_range after confirming with the user",
    arguments: [
      { name: "timelineId", required: true },
      { name: "startFrame", required: true },
      { name: "endFrame", required: true },
    ],
  },
  {
    name: "generate_inbetweens",
    description: "Interpolate between two keyframes with RIFE (candidate only). linear-blend is 快速預覽, not AI.",
    arguments: [
      { name: "timelineId", required: true },
      { name: "frameA", required: true },
      { name: "frameB", required: true },
    ],
  },
  {
    name: "ask_about_selection",
    description: "Ask about the current frame/region using workspace context — ASK/read-only",
    arguments: [
      { name: "sessionId", required: true },
      { name: "question", required: false },
    ],
  },
];

export function promptText(name: string, args: Record<string, string>): string {
  switch (name) {
    case "analyze_animation_problem":
      return `Use FrameLab tools. Call analyze_consistency on timeline ${args.timelineId} frames ${args.startFrame ?? "start"}–${args.endFrame ?? "end"}. Then get_problem_frames. Report frame numbers, scores, jobId, and suggested repair windows. Do not invent face/hand scores — those models are not loaded.`;
    case "analyze_character_motion":
      return `get_character_track for ${args.characterId}, then analyze_motion on that character's timeline.`;
    case "analyze_hand_consistency":
      return `Hand consistency requires RTMPose, which is MODEL_NOT_AVAILABLE. Call analyze_motion and analyze_consistency on ${args.timelineId} and state the limitation.`;
    case "analyze_object_contact":
      return `Call analyze_consistency on ${args.timelineId}. Contact from a pose model is unavailable. If tracking points exist, CONTACT_BREAK events are rule-based distance jumps; NCC tracks come from framelab-ncc — say so.`;
    case "suggest_repair_window":
      return `Call suggest_repair on timeline ${args.timelineId}. Quote velocity_ratio / TRACK_BREAK / pose-lite spikes. Do not execute_repair_plan.`;
    case "repair_animation_range":
      return `This is a high-risk edit. Confirm with the user, then call repair_frame_range timelineId=${args.timelineId} startFrame=${args.startFrame} endFrame=${args.endFrame}. A revision and job are created automatically.`;
    case "generate_inbetweens":
      return `Call create_inbetween_plan first, then generate_inbetweens with confirmed=true after the user confirms. timelineId=${args.timelineId} frameA=${args.frameA} frameB=${args.frameB} provider=rife quality=production. linear-blend is 快速預覽 only — not AI inbetweening. Do not write the active timeline until accept_generated_frames.`;
    case "ask_about_selection":
      return `ASK mode only. Call get_current_context with sessionId=${args.sessionId}, then get_selected_region and analyze_selection. Answer: ${args.question ?? "What looks inconsistent here?"}. Do not invent pose/joint metrics. Never edit frames.`;
    default:
      return `Unknown prompt ${name}`;
  }
}

export function parseResourceUri(uri: string): { kind: string; id: string; extra?: string } | null {
  const m = /^framelab:\/\/([a-z]+)\/([^/]+)(?:\/([a-z]+))?$/.exec(uri);
  if (!m) return null;
  return { kind: m[1], id: m[2], extra: m[3] };
}
