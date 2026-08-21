import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

export const listMyProjects = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const repo = await import("@/lib/framelab/repo");
    return repo.listProjects(context.userId);
  });

export const createSample = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { name?: string }) => data)
  .handler(async ({ context, data }) => {
    const { createSampleProject, ALL_SCOPES } = await import(
      "@/lib/commands/execute"
    );
    return createSampleProject(
      {
        userId: context.userId,
        source: "ui",
        caller: `user:${context.userId}`,
        scopes: ALL_SCOPES,
      },
      data.name,
    );
  });

export const createProjectFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { name: string; fps?: number }) => data)
  .handler(async ({ context, data }) => {
    const { createBlankProject, ALL_SCOPES } = await import(
      "@/lib/commands/execute"
    );
    return createBlankProject(
      {
        userId: context.userId,
        source: "ui",
        caller: `user:${context.userId}`,
        scopes: ALL_SCOPES,
      },
      data,
    );
  });

export const deleteProjectFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string }) => data)
  .handler(async ({ context, data }) => {
    const repo = await import("@/lib/framelab/repo");
    await repo.deleteProject(context.userId, data.projectId);
    return { deleted: data.projectId };
  });

export const getProjectBundle = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string }) => data)
  .handler(async ({ context, data }) => {
    const repo = await import("@/lib/framelab/repo");
    const project = await repo.getProject(context.userId, data.projectId);
    if (!project) return { ok: false as const, error: "找不到這個專案" };
    const timelines = await repo.listTimelines(project.id);
    const timeline = timelines[0] ?? null;
    const frames = timeline ? await repo.listFramesMeta(timeline.id) : [];
    const characters = await repo.listCharacters(project.id);
    const objects = await repo.listObjects(project.id);
    const consistency = timeline ? await repo.listConsistency(timeline.id) : [];
    const tracking = await repo.listTrackingPoints(project.id);
    const assignments = await repo.listProjectAssignments(project.id);
    const jobs = await repo.listJobs(context.userId, project.id);
    const motion = timeline ? await repo.listMotion(timeline.id) : [];
    const poses = timeline ? await repo.listPoses(timeline.id) : [];
    const problemRanges = timeline ? await repo.listProblemRanges(timeline.id) : [];
    return {
      ok: true as const,
      project,
      timeline,
      frames: frames.map((f) => ({
        id: f.id,
        timelineId: f.timeline_id,
        frameNumber: f.frame_number,
        timestampMs: f.timestamp_ms,
        durationMs: f.duration_ms,
        frameType: f.frame_type,
        thumbnailData: f.thumbnail_data,
        width: f.width,
        height: f.height,
        isLocked: f.is_locked,
        notes: f.notes,
        contentHash: f.content_hash,
      })),
      characters,
      objects,
      consistency,
      tracking,
      motion,
      poses: poses.map((p) => ({
        frame_id: p.frame_id,
        frame_number: p.frame_number,
        provider: p.provider,
        joints_json: p.joints_json,
        bbox_json: p.bbox_json,
      })),
      problemRanges: problemRanges.map((r) => ({
        start: r.start_frame,
        end: r.end_frame,
        peak_frame: r.peak_frame,
        category: r.category,
        severity: r.severity,
        score: r.score,
        reason: r.reason,
      })),
      assignments,
      jobs: jobs.map((j) => ({
        id: j.id,
        type: j.type,
        state: j.state,
        progress: j.progress,
        error_code: j.error_code,
        created_at: j.created_at,
        result_json: j.result_json,
      })),
    };
  });

export const getTimelineImagesFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; timelineId: string }) => data)
  .handler(async ({ context, data }) => {
    const repo = await import("@/lib/framelab/repo");
    const project = await repo.getProject(context.userId, data.projectId);
    if (!project) {
      return { ok: false as const, images: [] as { id: string; imageData: string }[] };
    }
    // The timeline must belong to the project we just proved ownership of --
    // checking one id and querying by another is not a check at all.
    const timeline = await repo.getTimeline(data.timelineId);
    if (!timeline || timeline.project_id !== project.id) {
      return { ok: false as const, images: [] as { id: string; imageData: string }[] };
    }
    const frames = await repo.listFramesFull(timeline.id);
    return {
      ok: true as const,
      images: frames.map((f) => ({ id: f.id, imageData: f.image_data })),
    };
  });

export const ingestSequenceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (data: {
      name?: string;
      fps: number;
      frames: { imageData: string; frameNumber: number }[];
      projectId?: string;
      replace?: boolean;
    }) => data,
  )
  .handler(async ({ context, data }) => {
    if (data.frames.length === 0) return { ok: false as const, error: "沒有影格" };
    if (data.frames.length > 32) {
      return {
        ok: false as const,
        error: "請分批上傳，每批最多 32 格",
      };
    }
    const { ingestFrames, ALL_SCOPES } = await import("@/lib/commands/execute");
    const result = await ingestFrames(
      {
        userId: context.userId,
        source: "ui",
        caller: `user:${context.userId}`,
        scopes: ALL_SCOPES,
      },
      data,
    );
    return { ok: true as const, ...result };
  });

export const runToolFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { tool: string; args: Record<string, unknown> }) => data)
  .handler(async ({ context, data }) => {
    const { executeTool, ALL_SCOPES } = await import("@/lib/commands/execute");
    const result = await executeTool(
      {
        userId: context.userId,
        source: "ui",
        caller: `user:${context.userId}`,
        scopes: ALL_SCOPES,
      },
      data.tool,
      data.args,
    );
    if (!result.ok) {
      return { ok: false as const, code: result.code, error: result.error, payload: "" };
    }
    return { ok: true as const, code: "", error: "", payload: JSON.stringify(result.data) };
  });

export const listRevisionsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string; frameId?: string }) => data)
  .handler(async ({ context, data }) => {
    const repo = await import("@/lib/framelab/repo");
    const p = await repo.getProject(context.userId, data.projectId);
    if (!p) return [];
    return repo.listRevisions(data.projectId, data.frameId);
  });

export const restoreRevisionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { revisionId: string }) => data)
  .handler(async ({ context, data }) => {
    const { restoreRevision, ALL_SCOPES } = await import(
      "@/lib/commands/execute"
    );
    return restoreRevision(
      {
        userId: context.userId,
        source: "ui",
        caller: `user:${context.userId}`,
        scopes: ALL_SCOPES,
      },
      data.revisionId,
    );
  });

export const getModelsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listModels, getDeviceInfo } = await import("@/lib/ai/registry");
  return { models: listModels(), devices: getDeviceInfo() };
});

export const createMcpTokenFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { name: string; scopes: string; projectScope?: string }) => data)
  .handler(async ({ context, data }) => {
    const { createHash, randomBytes } = await import("node:crypto");
    const { nid } = await import("@/lib/domain/ids");
    const { parseScopes } = await import("@/lib/domain/permissions");
    const repo = await import("@/lib/framelab/repo");
    const raw = `fl_${randomBytes(24).toString("hex")}`;
    const hash = createHash("sha256").update(raw).digest("hex");
    const id = nid("mcp");
    const scopes = parseScopes(data.scopes).join(",");
    await repo.insertMcpClient({
      id,
      user_id: context.userId,
      name: data.name.trim() || "Agent",
      token_hash: hash,
      token_prefix: raw.slice(0, 10),
      scopes: scopes || "READ,ANALYZE",
      project_scope: data.projectScope || "all",
      enabled: true,
      created_at: new Date().toISOString(),
    });
    return {
      id,
      token: raw,
      prefix: raw.slice(0, 10),
      scopes: scopes || "READ,ANALYZE",
      warning: "This token is shown once. Store it in the MCP client.",
    };
  });

export const listMcpTokensFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const repo = await import("@/lib/framelab/repo");
    const rows = await repo.listMcpClients(context.userId);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      tokenPrefix: r.token_prefix,
      scopes: r.scopes,
      projectScope: r.project_scope,
      enabled: r.enabled,
      createdAt: r.created_at,
    }));
  });

export const getJobFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data: { jobId: string }) => data)
  .handler(async ({ context, data }) => {
    const repo = await import("@/lib/framelab/repo");
    return repo.getJob(context.userId, data.jobId);
  });

export const updateNotesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { frameId: string; notes: string }) => data)
  .handler(async ({ context, data }) => {
    const repo = await import("@/lib/framelab/repo");
    const frame = await repo.getFrame(data.frameId);
    if (!frame) return { ok: false as const };
    const t = await repo.getTimeline(frame.timeline_id);
    if (!t) return { ok: false as const };
    const p = await repo.getProject(context.userId, t.project_id);
    if (!p) return { ok: false as const };
    await repo.updateFrame(frame.id, { notes: data.notes });
    return { ok: true as const };
  });

export const setLockedFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { frameId: string; locked: boolean }) => data)
  .handler(async ({ context, data }) => {
    const repo = await import("@/lib/framelab/repo");
    const frame = await repo.getFrame(data.frameId);
    if (!frame) return { ok: false as const };
    const t = await repo.getTimeline(frame.timeline_id);
    if (!t) return { ok: false as const };
    const p = await repo.getProject(context.userId, t.project_id);
    if (!p) return { ok: false as const };
    await repo.updateFrame(frame.id, { is_locked: data.locked });
    return { ok: true as const };
  });

export const listLLMProvidersFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const { listLLMProviders } = await import("@/lib/ai/llm-provider");
    return listLLMProviders();
  });

export const ensureWorkspaceSessionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (data: {
      sessionId: string;
      projectId: string;
      timelineId?: string | null;
      videoId?: string | null;
    }) => data,
  )
  .handler(async ({ context, data }) => {
    const repo = await import("@/lib/framelab/repo");
    const project = await repo.getProject(context.userId, data.projectId);
    if (!project) return { ok: false as const, error: "找不到這個專案" };
    const existing = await repo.getWorkspaceSession(context.userId, data.sessionId);
    if (existing && existing.project_id !== data.projectId) {
      return { ok: false as const, error: "Session belongs to another project" };
    }
    if (data.timelineId) {
      const timeline = await repo.getTimeline(data.timelineId);
      if (!timeline || timeline.project_id !== data.projectId) {
        return { ok: false as const, error: "時間軸不屬於這個專案" };
      }
    }
    if (!existing) {
      await repo.upsertWorkspaceSession({
        id: data.sessionId,
        userId: context.userId,
        projectId: data.projectId,
        timelineId: data.timelineId ?? null,
        videoId: data.videoId ?? null,
        contextVersion: 0,
        contextJson: "{}",
      });
    }
    const row = await repo.getWorkspaceSession(context.userId, data.sessionId);
    return { ok: true as const, session: row };
  });

export const syncWorkspaceSessionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (data: {
      sessionId: string;
      projectId: string;
      context: Record<string, unknown>;
    }) => data,
  )
  .handler(async ({ context, data }) => {
    const repo = await import("@/lib/framelab/repo");
    const project = await repo.getProject(context.userId, data.projectId);
    if (!project) return { ok: false as const, error: "找不到這個專案" };
    const snap = data.context as {
      project_id?: string | null;
      video_id?: string | null;
      timeline_id?: string | null;
      current_frame?: number | null;
      current_frame_id?: string | null;
      selected_range?: [number, number] | null;
      selected_frames?: number[];
      selected_character?: string | null;
      selected_object?: string | null;
      selected_region?: {
        frameId: string;
        frameNumber: number;
        x: number;
        y: number;
        width: number;
        height: number;
        selectionType: string;
      } | null;
      onion_skin?: unknown;
      overlay?: unknown;
      conversation_id?: string | null;
      context_version?: number;
    };
    if (snap.timeline_id) {
      const timeline = await repo.getTimeline(snap.timeline_id);
      if (!timeline || timeline.project_id !== data.projectId) {
        return { ok: false as const, error: "時間軸不屬於這個專案" };
      }
    }
    await repo.upsertWorkspaceSession({
      id: data.sessionId,
      userId: context.userId,
      projectId: data.projectId,
      timelineId: snap.timeline_id ?? null,
      videoId: snap.video_id ?? null,
      currentFrame: snap.current_frame ?? null,
      currentFrameId: snap.current_frame_id ?? null,
      selectedRangeJson: JSON.stringify(snap.selected_range ?? null),
      selectedFramesJson: JSON.stringify(snap.selected_frames ?? []),
      selectedRegionJson: JSON.stringify(snap.selected_region ?? null),
      selectedCharacterId: snap.selected_character ?? null,
      selectedObjectId: snap.selected_object ?? null,
      onionSkinJson: JSON.stringify(snap.onion_skin ?? {}),
      overlayJson: JSON.stringify(snap.overlay ?? {}),
      conversationId: snap.conversation_id ?? null,
      contextVersion: snap.context_version ?? 0,
      contextJson: JSON.stringify(data.context),
    });
    if (snap.selected_region) {
      await repo.insertRegionSelection({
        userId: context.userId,
        sessionId: data.sessionId,
        frameId: snap.selected_region.frameId,
        frameNumber: snap.selected_region.frameNumber,
        selectionType: snap.selected_region.selectionType ?? "rectangle",
        x: snap.selected_region.x,
        y: snap.selected_region.y,
        width: snap.selected_region.width,
        height: snap.selected_region.height,
      });
    }
    return { ok: true as const, contextVersion: snap.context_version ?? 0 };
  });

export const sendAskFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (data: {
      sessionId: string;
      conversationId?: string | null;
      providerId?: string | null;
      userMessage: string;
      lock?: { locked: boolean; snapshot: unknown | null };
      fps?: number;
      frameCount?: number;
      liveContext?: Record<string, unknown> | null;
      mode?: "ASK" | "ASSIST";
    }) => data,
  )
  .handler(async ({ context, data }) => {
    const { runAskTurn } = await import("@/lib/conversation/runtime");
    const { ALL_SCOPES } = await import("@/lib/commands/execute");
    const { hydrateContext } = await import("@/lib/domain/context-engine");
    try {
      if (data.liveContext) {
        const repo = await import("@/lib/framelab/repo");
        const snap = data.liveContext as {
          project_id?: string | null;
          video_id?: string | null;
          timeline_id?: string | null;
          current_frame?: number | null;
          current_frame_id?: string | null;
          selected_range?: [number, number] | null;
          selected_frames?: number[];
          selected_character?: string | null;
          selected_object?: string | null;
          selected_region?: {
            frameId: string;
            frameNumber: number;
            x: number;
            y: number;
            width: number;
            height: number;
            selectionType: string;
          } | null;
          onion_skin?: unknown;
          overlay?: unknown;
          conversation_id?: string | null;
          context_version?: number;
        };
        const projectId = typeof snap.project_id === "string" ? snap.project_id : null;
        if (projectId) {
          const project = await repo.getProject(context.userId, projectId);
          if (project) {
            await repo.upsertWorkspaceSession({
              id: data.sessionId,
              userId: context.userId,
              projectId,
              timelineId: snap.timeline_id ?? null,
              videoId: snap.video_id ?? null,
              currentFrame: snap.current_frame ?? null,
              currentFrameId: snap.current_frame_id ?? null,
              selectedRangeJson: JSON.stringify(snap.selected_range ?? null),
              selectedFramesJson: JSON.stringify(snap.selected_frames ?? []),
              selectedRegionJson: JSON.stringify(snap.selected_region ?? null),
              selectedCharacterId: snap.selected_character ?? null,
              selectedObjectId: snap.selected_object ?? null,
              onionSkinJson: JSON.stringify(snap.onion_skin ?? {}),
              overlayJson: JSON.stringify(snap.overlay ?? {}),
              conversationId: snap.conversation_id ?? null,
              contextVersion: snap.context_version ?? 0,
              contextJson: JSON.stringify(data.liveContext),
            });
            if (snap.selected_region) {
              await repo.insertRegionSelection({
                userId: context.userId,
                sessionId: data.sessionId,
                frameId: snap.selected_region.frameId,
                frameNumber: snap.selected_region.frameNumber,
                selectionType: snap.selected_region.selectionType ?? "rectangle",
                x: snap.selected_region.x,
                y: snap.selected_region.y,
                width: snap.selected_region.width,
                height: snap.selected_region.height,
              });
            }
          }
        }
      }
      const live = data.liveContext
        ? hydrateContext(data.liveContext as import("@/lib/domain/context-engine").SerializedContext)
        : undefined;
      const result = await runAskTurn({
        ctx: {
          userId: context.userId,
          source: "ui",
          caller: `user:${context.userId}`,
          scopes: ALL_SCOPES,
        },
        sessionId: data.sessionId,
        conversationId: data.conversationId,
        providerId: data.providerId,
        userMessage: data.userMessage,
        liveContext: live,
        lock: data.lock
          ? {
              locked: data.lock.locked,
              snapshot: data.lock.snapshot as never,
            }
          : undefined,
        fps: data.fps,
        frameCount: data.frameCount,
        mode: data.mode === "ASSIST" ? "ASSIST" : "ASK",
      });
      return { ok: true as const, ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/workspace session|Invalid workspace/i.test(message)) {
        return { ok: false as const, error: "讀不到工作區上下文。" };
      }
      if (/no longer exists/i.test(message)) {
        return { ok: false as const, error: "選取的影格已經不存在。" };
      }
      return { ok: false as const, error: message };
    }
  });

export const listConversationsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string }) => data)
  .handler(async ({ context, data }) => {
    const repo = await import("@/lib/framelab/repo");
    const project = await repo.getProject(context.userId, data.projectId);
    if (!project) return [];
    return repo.listConversations(context.userId, data.projectId);
  });

export const listConversationMessagesFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data: { conversationId: string }) => data)
  .handler(async ({ context, data }) => {
    const repo = await import("@/lib/framelab/repo");
    const conv = await repo.getConversation(context.userId, data.conversationId);
    if (!conv) return { ok: false as const, messages: [] as never[] };
    const messages = await repo.listMessages(data.conversationId);
    return { ok: true as const, conversation: conv, messages };
  });

export const setConversationLockFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (data: {
      conversationId: string;
      locked: boolean;
      snapshotJson?: string | null;
    }) => data,
  )
  .handler(async ({ context, data }) => {
    const repo = await import("@/lib/framelab/repo");
    await repo.updateConversation(context.userId, data.conversationId, {
      contextLocked: data.locked,
      lockedSnapshotJson: data.locked ? (data.snapshotJson ?? "null") : "null",
    });
    return { ok: true as const };
  });

export const conversationMarkersFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data: { projectId: string }) => data)
  .handler(async ({ context, data }) => {
    const repo = await import("@/lib/framelab/repo");
    const project = await repo.getProject(context.userId, data.projectId);
    if (!project) return [];
    return repo.conversationCountsByFrame(context.userId, data.projectId);
  });

