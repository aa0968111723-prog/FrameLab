export type FrameLabClientOptions = {
  baseUrl: string;
  token?: string;
};

export class FrameLabClient {
  constructor(private readonly opts: FrameLabClientOptions) {}

  private async call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.opts.token) headers.authorization = `Bearer ${this.opts.token}`;
    const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/api/v1?tool=${encodeURIComponent(tool)}`, {
      method: "POST",
      headers,
      body: JSON.stringify(args),
    });
    return (await res.json()) as T;
  }

  listProjects() {
    return this.call("list_projects");
  }
  getProject(projectId: string) {
    return this.call("get_project", { projectId });
  }
  createProject(args: { name: string; fps?: number }) {
    return this.call("create_project", args);
  }
  getFrame(args: { frameId?: string; timelineId?: string; frameNumber?: number }) {
    return this.call("get_frame", args);
  }
  getFrameRange(args: { timelineId: string; startFrame: number; endFrame: number }) {
    return this.call("get_frame_range", args);
  }
  getFrameWindow(args: { timelineId: string; centerFrame: number; before?: number; after?: number }) {
    return this.call("get_frame_window", args);
  }
  analyzeRange(args: { timelineId: string; startFrame?: number; endFrame?: number }) {
    return this.call("analyze_frame_range", args);
  }
  generateInbetweens(args: {
    timelineId: string;
    frameA: number;
    frameB: number;
    count?: number;
    curve?: string;
    provider?: string;
    confirmed?: boolean;
    preserveCharacter?: boolean;
    preserveBackground?: boolean;
    preserveFace?: boolean;
    maintainContact?: boolean;
    force?: boolean;
    quality?: string;
  }) {
    return this.call("generate_inbetweens", { ...args, confirmed: args.confirmed ?? true });
  }
  createInbetweenPlan(args: {
    timelineId: string;
    startFrame: number;
    endFrame: number;
    count?: number;
    curve?: string;
    intent?: string;
  }) {
    return this.call("create_inbetween_plan", args);
  }
  getCandidate(candidateId: string) {
    return this.call("get_candidate", { candidateId });
  }
  getProblemFrames(args: { timelineId: string }) {
    return this.call("get_problem_frames", args);
  }
  repairRange(args: { timelineId: string; startFrame: number; endFrame: number }) {
    return this.call("repair_frame_range", args);
  }
  repairFrame(args: { frameId: string; method?: string }) {
    return this.call("repair_frame", args);
  }
  getJob(jobId: string) {
    return this.call("get_job", { jobId });
  }
  getCharacterTrack(characterId: string) {
    return this.call("get_character_track", { characterId });
  }
  getFrameAnalysis(frameId: string) {
    return this.call("get_frame_analysis", { frameId });
  }
  getGraph(projectId: string, edgeType?: string) {
    return this.call("get_graph", { projectId, edgeType });
  }
  listCharacters(projectId: string) {
    return this.call("list_characters", { projectId });
  }
  assignCharacterRange(args: {
    timelineId: string;
    characterId: string;
    startFrame: number;
    endFrame: number;
  }) {
    return this.call("assign_character_range", args);
  }
  undo(args: { projectId: string; frameId?: string; revisionId?: string }) {
    return this.call("undo", args);
  }
  redo(args: { projectId: string; frameId?: string }) {
    return this.call("redo", args);
  }
  createKeyframeRange(args: { timelineId: string; startFrame: number; endFrame: number }) {
    return this.call("create_keyframe_range", args);
  }
  restoreRevision(revisionId: string, confirmed = true) {
    return this.call("restore_revision", { revisionId, confirmed });
  }
  acceptRevision(revisionId: string) {
    return this.call("accept_revision", { revisionId });
  }
  render(args: { timelineId: string; startFrame?: number; endFrame?: number }) {
    return this.call("render_animation", args);
  }
  createSample(name?: string) {
    return this.call("create_sample_project", { name });
  }
  getTimeline(timelineId: string) {
    return this.call("get_timeline", { timelineId });
  }
  analyzeFrame(args: { frameId?: string; timelineId?: string; frameNumber?: number; level?: string; vlm?: boolean }) {
    return this.call("analyze_frame", args);
  }
  createKeyframe(args: { timelineId: string; frameNumber: number }) {
    return this.call("create_keyframe", args);
  }
  interpolateFrames(args: { timelineId: string; frameA: number; frameB: number; count?: number; curve?: string }) {
    return this.call("interpolate_frames", args);
  }
  getModelStatus() {
    return this.call("get_model_status");
  }
  listJobs(projectId?: string) {
    return this.call("list_jobs", projectId ? { projectId } : {});
  }
  cancelJob(jobId: string) {
    return this.call("cancel_job", { jobId });
  }
  regenerateRegion(args: {
    frameId: string;
    x: number;
    y: number;
    w: number;
    h: number;
    region?: string;
    method?: string;
  }) {
    return this.call("regenerate_region", args);
  }
  getCurrentContext(sessionId: string) {
    return this.call("get_current_context", { sessionId });
  }
  getCurrentFrame(sessionId: string) {
    return this.call("get_current_frame", { sessionId });
  }
  getSelectedFrames(sessionId: string) {
    return this.call("get_selected_frames", { sessionId });
  }
  getSelectedFrameRange(sessionId: string) {
    return this.call("get_selected_frame_range", { sessionId });
  }
  getSelectedRegion(sessionId: string) {
    return this.call("get_selected_region", { sessionId });
  }
  getFrameNeighbors(args: { frameId?: string; sessionId?: string; before?: number; after?: number }) {
    return this.call("get_frame_neighbors", args);
  }
  analyzeSelection(args: { sessionId: string; analysis_types?: string[] }) {
    return this.call("analyze_selection", args);
  }
  analyzeMotionContext(args: { sessionId?: string; timelineId?: string; startFrame?: number; endFrame?: number }) {
    return this.call("analyze_motion_context", args);
  }
  compareFrames(args: {
    timelineId?: string;
    sessionId?: string;
    frameA: number;
    frameB: number;
    region?: unknown;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
  }) {
    return this.call("compare_frames", args);
  }
  analyzeMotion(args: { timelineId: string; startFrame?: number; endFrame?: number; provider?: string; region?: unknown }) {
    return this.call("analyze_motion", args);
  }
  analyzePose(args: { timelineId: string; startFrame?: number; endFrame?: number; provider?: string }) {
    return this.call("analyze_pose", args);
  }
  analyzeTracking(args: { timelineId: string; name?: string; provider?: string }) {
    return this.call("analyze_tracking", args);
  }
  analyzeConsistency(args: { timelineId: string; startFrame?: number; endFrame?: number }) {
    return this.call("analyze_consistency", args);
  }
  getProblemRanges(args: { timelineId: string }) {
    return this.call("get_problem_ranges", args);
  }
  createRepairPlan(args: { timelineId: string; startFrame?: number; endFrame?: number }) {
    return this.call("create_repair_plan", args);
  }
  suggestRepair(args: { timelineId: string; startFrame?: number; endFrame?: number; sessionId?: string }) {
    return this.call("suggest_repair", args);
  }
  executeRepairPlan(args: { planId: string; provider?: string; confirmed?: boolean }) {
    return this.call("execute_repair_plan", { ...args, confirmed: args.confirmed ?? true });
  }
  compareRevision(revisionId: string) {
    return this.call("compare_before_after", { revisionId });
  }
  createKeyframePair(args: { timelineId: string; startFrame: number; endFrame: number; count?: number }) {
    return this.call("create_keyframe_pair", args);
  }
  analyzeTransition(args: { timelineId: string; startFrame: number; endFrame: number }) {
    return this.call("analyze_keyframe_transition", args);
  }
  createMotionPlan(args: {
    timelineId: string;
    startFrame: number;
    endFrame: number;
    count?: number;
    curve?: string;
  }) {
    return this.call("create_motion_plan", args);
  }
  suggestBreakdowns(args: { timelineId: string; startFrame: number; endFrame: number }) {
    return this.call("suggest_breakdown_frames", args);
  }
  createBreakdown(args: {
    timelineId: string;
    startFrame: number;
    endFrame: number;
    frameNumber?: number;
    mode?: "blank" | "copy" | "mark";
    copyFrom?: "start" | "end" | number;
    frameType?: string;
  }) {
    return this.call("create_breakdown", args);
  }
  getGenerationJob(jobId: string) {
    return this.call("get_generation_job", { jobId });
  }
  evaluateInbetweens(candidateId: string) {
    return this.call("evaluate_inbetweens", { candidateId });
  }
  regenerateRange(args: { candidateId: string; confirmed?: boolean; curve?: string }) {
    return this.call("regenerate_inbetween_range", { ...args, confirmed: args.confirmed ?? true });
  }
  acceptCandidate(candidateId: string, confirmed = true) {
    return this.call("accept_generated_frames", { candidateId, confirmed });
  }
  rejectCandidate(candidateId: string) {
    return this.call("reject_generated_frames", { candidateId });
  }
  generateBreakdown(args: { timelineId: string; startFrame: number; endFrame: number; frameNumber?: number; confirmed?: boolean }) {
    return this.call("generate_breakdown_frame", { ...args, confirmed: args.confirmed ?? true });
  }
  editPose(args: {
    timelineId: string;
    frameNumber: number;
    joint: string;
    x: number;
    y: number;
    keypoints?: { name: string; x: number; y: number; confidence?: number }[];
  }) {
    return this.call("edit_pose", args);
  }
  listPoseConstraints(args: { timelineId: string; frameNumber?: number }) {
    return this.call("list_pose_constraints", args);
  }
  setFrameExposure(args: { frameId: string; exposure: number }) {
    return this.call("set_frame_exposure", args);
  }
  getKeyframePair(pairId: string) {
    return this.call("get_keyframe_pair", { pairId });
  }
  getMotionPlan(planId: string) {
    return this.call("get_motion_plan", { planId });
  }
  exportFrameSequence(args: { timelineId: string; startFrame?: number; endFrame?: number }) {
    return this.call("export_frame_sequence", args);
  }
}

export { FrameLabClient as default };
