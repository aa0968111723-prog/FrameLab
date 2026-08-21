import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  FlipHorizontal,
  Keyboard,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  Repeat,
  ScanSearch,
  SkipBack,
  SkipForward,
  Wand2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { UserButton, RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  ensureWorkspaceSessionFn,
  getProjectBundle,
  getTimelineImagesFn,
  listLLMProvidersFn,
  listRevisionsFn,
  listConversationMessagesFn,
  listConversationsFn,
  restoreRevisionFn,
  runToolFn,
  sendAskFn,
  setConversationLockFn,
  setLockedFn,
  syncWorkspaceSessionFn,
  updateNotesFn,
} from "@/lib/framelab/api";
import {
  createTimelineState,
  nextFrame,
  previousFrame,
  seek,
  selectRange,
  setLoopRange,
  setOnionSkin,
  setZoom,
} from "@/lib/domain/timeline-engine";
import { padFrame } from "@/lib/domain/types";
import { jobStageLabel, parseJobStage } from "@/lib/domain/job-progress";
import { annotationsFromProblems, categoryLabel, type VisualAnnotation } from "@/lib/domain/visual-annotation";
import { propagateMask } from "@/lib/domain/region-repair";
import { parseAnimationIntent, intentToConstraintFlags, isInbetweenRequest, isCurveAdjustRequest } from "@/lib/domain/animation-intent";
import type { InbetweenAskPayload } from "@/lib/domain/conversation";
import { curveCaption, curvePathD, spacingDots } from "@/lib/visual/motion-curve-visual";
import { locateProblemBox } from "@/lib/visual/problem-locate";
import { buildPresence } from "@/lib/visual/character-track";
import { maskTrackMarks } from "@/lib/visual/timeline-virtual";
import { suggestedFocusZoom, zoom100Percent } from "@/lib/visual/viewport";
import {
  MODE_BAR,
  PLAYBACK_SPEEDS,
  TRAIL_TARGETS,
  chromeForMode,
  defaultOverlayForMode,
  setPrimary,
  toggleExtra,
  type CompareMode,
  type OverlayStack,
  type ProblemFilter,
  type TrailTarget,
  type WorkspaceMode,
} from "@/lib/visual/workspace-mode";
import { cn } from "@/lib/utils";
import { AnimationCanvas, type CanvasTool } from "./animation-canvas";
import { ConversationPanel, type ChatLine, chipsFromSnapshot } from "./conversation-panel";
import { InbetweenPanel, type InbetweenCandidateView, type InbetweenPanelState } from "./inbetween-panel";
import { SpacingStrip, VisualTimeline } from "./visual-timeline";
import { ProblemNavigator } from "./problem-navigator";
import { ConsistencyStrips } from "./consistency-strips";
import { RegionActions } from "./region-actions";
import { ConstraintChips, MotionPlanVisual } from "./motion-plan-visual";
import { AdvancedInspector } from "./inspector-advanced";
import { ContextInspector } from "./context-inspector";
import { RegionSelectorStatus } from "./region-selector";
import { CharacterBoard } from "./character-board";

const MODE_LABEL: Record<WorkspaceMode, string> = {
  ANIMATE: "動畫",
  ANALYZE: "分析",
  REPAIR: "修復",
  REVIEW: "檢視",
  GENERATE: "生成",
};

const TOOL_LABEL: Record<CanvasTool, string> = {
  pan: "平移",
  region: "選區",
  point: "錨點",
  character: "角色",
};

const TRAIL_ZH: Record<TrailTarget, string> = {
  head: "頭",
  left_hand: "左手",
  right_hand: "右手",
  hip: "髖",
  foot: "腳",
  object: "物件",
  custom: "自訂",
};

const TOOL_DONE_ZH: Record<string, string> = {
  create_keyframe: "已標成關鍵影格",
  remove_keyframe: "已取消關鍵影格",
  mark_breakdown: "已標成分解影格",
  analyze_consistency: "一致性掃描完成",
  analyze_frame: "影格分析完成",
  analyze_motion: "運動分析完成",
  analyze_tracking: "追蹤分析完成",
  analyze_pose: "姿態分析完成",
  repair_frame: "影格已修復",
  repair_frame_range: "範圍已修復",
  regenerate_region: "區域已混合",
  duplicate_frame: "影格已複製",
  delete_frame: "影格已刪除",
  undo: "已復原",
  redo: "已重做",
  create_character: "角色已新增",
  assign_character: "已指定角色",
  create_object: "物件已新增",
  assign_object: "已指定物件",
  detect_keyframes: "已偵測關鍵影格",
  create_tracking_point: "追蹤點已建立",
  accept_generated_frames: "已寫入時間軸",
  reject_generated_frames: "已捨棄候選",
  set_frame_type: "影格類型已更新",
  set_frame_duration: "時長已更新",
  set_frame_exposure: "曝光已更新",
  execute_repair_plan: "修復已執行",
  create_repair_plan: "修復計畫已建立",
};

function jpegUrl(b64?: string) {
  if (!b64) return "";
  return b64.startsWith("data:") ? b64 : `data:image/jpeg;base64,${b64}`;
}

export function StudioApp({ projectId }: { projectId: string }) {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return <div className="min-h-screen bg-bg" />;
  if (!user) return <RedirectToSignIn />;
  return <StudioInner projectId={projectId} />;
}

function StudioInner({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const bundle = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProjectBundle({ data: { projectId } }),
  });
  const images = useQuery({
    queryKey: ["images", projectId, bundle.data?.timeline?.id],
    enabled: Boolean(bundle.data?.ok && bundle.data.timeline),
    queryFn: () =>
      getTimelineImagesFn({
        data: { projectId, timelineId: bundle.data!.timeline!.id },
      }),
  });
  const llm = useQuery({ queryKey: ["llm"], queryFn: () => listLLMProvidersFn() });

  const [engine, setEngine] = useState(() =>
    createTimelineState({
      fps: 24,
      onionSkin: { enabled: true, prev: 2, next: 2, opacityPrev: 0.38, opacityNext: 0.28 },
    }),
  );
  const [overlayStack, setOverlayStack] = useState<OverlayStack>({ primary: "original", extras: [] });
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("ANIMATE");
  const [focusMode, setFocusMode] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [flicker, setFlicker] = useState(false);
  const [compareMode, setCompareMode] = useState<CompareMode>("flicker");
  const [holdCompare, setHoldCompare] = useState(false);
  const [compareFrame, setCompareFrame] = useState<number | null>(null);
  const [canvasTool, setCanvasTool] = useState<CanvasTool>("pan");
  const [trailTarget, setTrailTarget] = useState<TrailTarget>("right_hand");
  const [selectedJoint, setSelectedJoint] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<VisualAnnotation[]>([]);
  const [highlightRange, setHighlightRange] = useState<[number, number] | null>(null);
  const [repairViz, setRepairViz] = useState<[number, number] | null>(null);
  const [repairPlanId, setRepairPlanId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<"problems" | "inbetween" | "advanced">("problems");
  const [fitTick, setFitTick] = useState(0);
  const [focusTick, setFocusTick] = useState(0);
  const [focusRegion, setFocusRegion] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [help, setHelp] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [pixelView, setPixelView] = useState(false);
  const [regionBox, setRegionBox] = useState({ x: 40, y: 40, w: 64, h: 64 });
  const [regionLive, setRegionLive] = useState(false);
  const [regionKind, setRegionKind] = useState("custom");
  const [revisionPreview, setRevisionPreview] = useState<{ frameNumber: number; data: string } | null>(null);
  const [compareSources, setCompareSources] = useState<{
    original?: string | null;
    candidate?: string | null;
    previous?: string | null;
  } | null>(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [contextVersion, setContextVersion] = useState(1);
  const [contextLocked, setContextLocked] = useState(false);
  const [frozenContext, setFrozenContext] = useState<Record<string, unknown> | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [askBusy, setAskBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(`fl-cnv:${projectId}`) ?? null;
    } catch {
      return null;
    }
  });
  const [sessionId] = useState(() => {
    try {
      const key = `fl-ses:${projectId}`;
      let id = sessionStorage.getItem(key);
      if (!id) {
        id =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? `ses-${crypto.randomUUID()}`
            : `ses-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        sessionStorage.setItem(key, id);
      }
      return id;
    } catch {
      return `ses-${projectId.slice(0, 8)}-${Date.now().toString(36)}`;
    }
  });
  const [providerId, setProviderId] = useState("grok");
  const [askMode, setAskMode] = useState<"ASK" | "ASSIST">("ASSIST");
  const [aiState, setAiState] = useState<"idle" | "looking" | "analyzing" | "suggestion" | "problem">("idle");
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [problemFilter, setProblemFilter] = useState<ProblemFilter>("All");
  const [charTrack, setCharTrack] = useState(false);
  const [maskTrack, setMaskTrack] = useState<{ frame: number; mask: { x: number; y: number; w: number; h: number }; lost?: boolean; confidence?: number }[]>([]);
  const [problemMenu, setProblemMenu] = useState(false);
  const [inb, setInb] = useState<InbetweenPanelState>({
    start: null,
    end: null,
    count: 9,
    curve: "ease_in_out",
    quality: "preview",
    constraints: {
      preserveCharacter: true,
      preserveFace: true,
      preserveBackground: true,
      maintainContact: false,
      keepCameraStatic: true,
    },
    analysis: null,
    confirmation: null,
    candidate: null,
    plan: null,
    busy: false,
  });
  const playRef = useRef<number | null>(null);
  const accRef = useRef(0);
  const lastRef = useRef(0);

  const frames = useMemo(() => (bundle.data?.ok ? bundle.data.frames : []), [bundle.data]);
  const imageMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const im of images.data?.images ?? []) m.set(im.id, im.imageData);
    return m;
  }, [images.data]);
  const consMap = useMemo(() => {
    const m = new Map<number, { severity: string; scores_json: string; repair_start: number | null; repair_end: number | null }>();
    for (const c of bundle.data?.ok ? bundle.data.consistency : []) m.set(c.frame_number, c);
    return m;
  }, [bundle.data]);
  // These must be memoised, not derived inline. `?? []` mints a fresh array on
  // every render whenever the field is absent, and problemRanges/poses/tracking
  // are dependencies of the annotation effect below: a new identity each render
  // re-runs the effect, which setAnnotations() with a freshly built array, which
  // renders again — an unbounded loop that pins the studio the moment a bundle
  // comes back without one of those fields. Memoising on bundle.data keeps the
  // identity stable between fetches.
  const problemRanges = useMemo(
    () => (bundle.data?.ok ? (bundle.data.problemRanges ?? []) : []),
    [bundle.data],
  );
  const poses = useMemo(
    () => (bundle.data?.ok ? (bundle.data.poses ?? []) : []),
    [bundle.data],
  );
  const tracking = useMemo(
    () => (bundle.data?.ok ? (bundle.data.tracking ?? []) : []),
    [bundle.data],
  );
  const jobs = useMemo(
    () => (bundle.data?.ok ? (bundle.data.jobs ?? []) : []),
    [bundle.data],
  );
  const characters = useMemo(
    () => (bundle.data?.ok ? bundle.data.characters : []),
    [bundle.data],
  );
  const objects = useMemo(
    () => (bundle.data?.ok ? (bundle.data.objects ?? []) : []),
    [bundle.data],
  );
  const assignments = useMemo(
    () => (bundle.data?.ok ? (bundle.data.assignments ?? []) : []),
    [bundle.data],
  );

  useEffect(() => {
    if (contextLocked) return;
    setContextVersion((v) => v + 1);
  }, [
    engine.currentFrame,
    engine.selectedRange,
    regionLive,
    regionBox.x,
    regionBox.y,
    regionBox.w,
    regionBox.h,
    selectedCharacterId,
    selectedObjectId,
    contextLocked,
  ]);

  useEffect(() => {
    if (!bundle.data?.ok) return;
    const count = bundle.data.frames.length;
    const fps = bundle.data.project.fps;
    setEngine((s) => ({
      ...s,
      fps,
      frameCount: count,
      currentFrame: Math.min(s.currentFrame, Math.max(0, count - 1)),
    }));
  }, [bundle.data]);

  useEffect(() => {
    const parsePose = (n: number) => {
      const row = poses.find((p) => p.frame_number === n);
      if (!row) return [];
      try {
        return JSON.parse(row.joints_json) as { name: string; x: number; y: number; confidence: number }[];
      } catch {
        return [];
      }
    };
    const fw = frames[0]?.width ?? 320;
    const fh = frames[0]?.height ?? 180;
    const anns = annotationsFromProblems(problemRanges, (p) =>
      locateProblemBox({
        category: p.category,
        frameNumber: p.peak,
        frameWidth: fw,
        frameHeight: fh,
        joints: parsePose(p.peak),
        tracking,
      }),
    );
    setAnnotations(anns);
    if (problemRanges.length) setAiState("problem");
  }, [problemRanges, poses, tracking, frames]);

  useEffect(() => {
    void ensureWorkspaceSessionFn({
      data: {
        sessionId,
        projectId,
        timelineId: bundle.data?.ok ? bundle.data.timeline?.id : null,
      },
    });
  }, [sessionId, projectId, bundle.data]);

  const conversations = useQuery({
    queryKey: ["conversations", projectId],
    queryFn: () => listConversationsFn({ data: { projectId } }),
  });

  const current = frames.find((f) => f.frameNumber === engine.currentFrame) ?? frames[0];
  const timelineId = bundle.data?.ok ? bundle.data.timeline?.id : undefined;
  const regionMode = canvasTool === "region";
  const commitRegion = (box: { x: number; y: number; w: number; h: number }) => {
    setRegionBox(box);
    setRegionLive(true);
    setCanvasTool("region");
    setOverlayStack((s) => setPrimary(s, "mask"));
  };
  const conversationCounts = useMemo(() => {
    const m: Record<number, number> = {};
    for (const c of conversations.data ?? []) {
      if (typeof c.frame_start === "number") m[c.frame_start] = (m[c.frame_start] ?? 0) + 1;
    }
    return m;
  }, [conversations.data]);
  const conversationFrames = useMemo(
    () => Object.keys(conversationCounts).map(Number),
    [conversationCounts],
  );
  async function onOpenConversation(id: string) {
    setConversationId(id);
    setAiOpen(true);
    try {
      const r = await listConversationMessagesFn({ data: { conversationId: id } });
      if (!r.ok) return;
      setChat(
        r.messages.map((m) => ({
          id: m.id,
          role: m.role === "assistant" || m.role === "tool" || m.role === "system" ? m.role : "user",
          content: m.content,
          contextVersion: m.context_version,
        })),
      );
    } catch {
      /* keep local chat */
    }
  }
  function openThread() {
    setAiOpen(true);
  }
  function openConversationAtFrame(n: number) {
    const hit = (conversations.data ?? []).find((c) => c.frame_start === n);
    if (hit) void onOpenConversation(hit.id);
    else {
      setEngine((s) => seek(s, n));
      setAiOpen(true);
    }
  }

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["project", projectId] });
    void qc.invalidateQueries({ queryKey: ["images", projectId] });
    void qc.invalidateQueries({ queryKey: ["conversations", projectId] });
    void qc.invalidateQueries({ queryKey: ["rev", projectId] });
  };

  const tool = useMutation({
    mutationFn: (input: { tool: string; args: Record<string, unknown> }) => runToolFn({ data: input }),
    onSuccess: (r: { ok: boolean; code: string; error: string; payload: string }, input) => {
      if (!r.ok) {
        toast.error(`${r.code}: ${r.error}`);
        setInb((s) => ({ ...s, busy: false }));
        return;
      }
      if (input.tool === "create_inbetween_plan" && r.payload) {
        try {
          const d = JSON.parse(r.payload) as {
            confirmation?: InbetweenPanelState["confirmation"];
            plan?: InbetweenPanelState["plan"];
            transition?: InbetweenPanelState["analysis"];
            strategy?: { kind: string; provider: string; reason: string };
          };
          setInb((s) => ({
            ...s,
            busy: false,
            confirmation: d.confirmation ?? s.confirmation,
            plan: d.plan ?? s.plan,
            analysis: d.transition
              ? {
                  complexity: (d.transition as { complexity?: string }).complexity ?? "LOW",
                  score: 0,
                  reasons: (d.transition as { reasons?: string[] }).reasons ?? [],
                  suggest_breakdown: Boolean((d.plan as { breakdowns?: number[] } | null)?.breakdowns?.length),
                  suggested_breakdown: (d.plan as { breakdowns?: number[] } | null)?.breakdowns?.[0] ?? null,
                  strategy: d.strategy ?? { kind: "interpolation", provider: "linear-blend", reason: "" },
                }
              : s.analysis,
          }));
          setRightTab("inbetween");
        } catch {
          setInb((s) => ({ ...s, busy: false }));
        }
      } else if (input.tool === "generate_inbetweens" && r.payload) {
        try {
          const d = JSON.parse(r.payload) as InbetweenPanelState["candidate"] & { candidateId?: string };
          setInb((s) => ({
            ...s,
            busy: false,
            candidate: d
              ? {
                  candidateId: d.candidateId ?? "",
                  previousCandidateId: s.candidate?.candidateId,
                  previousFrames: s.candidate?.frames,
                  provider: d.provider,
                  count: d.count,
                  quality: d.quality,
                  evaluation: d.evaluation,
                  warnings: d.warnings,
                  frames: d.frames ?? [],
                }
              : s.candidate,
            confirmation: null,
          }));
          setOverlayStack({ primary: "compare", extras: ["onion"] });
          setCompareMode("side");
          setWorkspaceMode("GENERATE");
          const firstN = d.frames?.[0]?.frameNumber;
          if (typeof firstN === "number") {
            setEngine((s) => seek(s, firstN));
            setCompareFrame(firstN);
          }
          const orig = frames.find((f) => f.frameNumber === firstN);
          const cand = d.frames?.[0];
          const prev = inb.candidate?.frames[0];
          setCompareSources({
            original: orig ? imageMap.get(orig.id) || orig.thumbnailData : null,
            candidate: cand?.imageData || cand?.thumbnailData || null,
            previous: prev?.imageData || prev?.thumbnailData || null,
          });
        } catch {
          setInb((s) => ({ ...s, busy: false }));
        }
      } else if (input.tool === "regenerate_inbetween_range" && r.payload) {
        try {
          const d = JSON.parse(r.payload) as InbetweenPanelState["candidate"] & {
            candidateId?: string;
            previousCandidateId?: string;
            previousFrames?: InbetweenCandidateView["frames"];
          };
          setInb((s) => ({
            ...s,
            busy: false,
            candidate: d
              ? {
                  candidateId: d.candidateId ?? "",
                  previousCandidateId: d.previousCandidateId ?? s.candidate?.candidateId,
                  previousFrames: d.previousFrames ?? s.candidate?.frames,
                  provider: d.provider ?? s.candidate?.provider ?? "linear-blend",
                  count: d.count ?? d.frames?.length ?? 0,
                  quality: d.quality ?? s.candidate?.quality ?? "preview",
                  evaluation: d.evaluation,
                  warnings: d.warnings,
                  frames: d.frames ?? [],
                }
              : s.candidate,
          }));
          setOverlayStack({ primary: "compare", extras: [] });
          setCompareMode("side");
        } catch {
          setInb((s) => ({ ...s, busy: false }));
        }
      } else if (input.tool === "create_repair_plan" && r.payload) {
        try {
          const d = JSON.parse(r.payload) as { planId?: string; id?: string; repair_range?: [number, number] };
          setRepairPlanId(d.planId ?? d.id ?? null);
          if (d.repair_range) setRepairViz(d.repair_range);
        } catch {
          /* ignore */
        }
      } else if (input.tool === "focus_problem" && r.payload) {
        try {
          const d = JSON.parse(r.payload) as { frame?: number; range?: [number, number]; annotation?: VisualAnnotation };
          if (typeof d.frame === "number") setEngine((s) => seek(s, d.frame!));
          if (d.range) setHighlightRange(d.range);
          if (d.annotation) setAnnotations((a) => [...a, d.annotation!]);
        } catch {
          /* ignore */
        }
      } else {
        toast.success(TOOL_DONE_ZH[input.tool] ?? "完成");
      }
      refresh();
    },
    onError: (e) => {
      toast.error(e.message);
      setInb((s) => ({ ...s, busy: false }));
    },
  });

  const step = useCallback((dir: 1 | -1) => {
    setEngine((s) => (dir > 0 ? nextFrame({ ...s, isPlaying: false }) : previousFrame({ ...s, isPlaying: false })));
  }, []);

  useEffect(() => {
    if (!engine.isPlaying) {
      if (playRef.current) cancelAnimationFrame(playRef.current);
      playRef.current = null;
      return;
    }
    lastRef.current = performance.now();
    accRef.current = 0;
    const tick = (now: number) => {
      const dt = (now - lastRef.current) * playbackSpeed;
      lastRef.current = now;
      const frame = frames.find((f) => f.frameNumber === engine.currentFrame);
      const dur = frame?.durationMs ?? Math.round(1000 / Math.max(1, engine.fps));
      accRef.current += dt;
      if (accRef.current >= dur) {
        accRef.current -= dur;
        setEngine((s) => nextFrame({ ...s, isPlaying: true }));
      }
      playRef.current = requestAnimationFrame(tick);
    };
    playRef.current = requestAnimationFrame(tick);
    return () => {
      if (playRef.current) cancelAnimationFrame(playRef.current);
    };
  }, [engine.isPlaying, engine.currentFrame, engine.fps, frames, playbackSpeed]);

  function setMode(mode: WorkspaceMode) {
    setWorkspaceMode(mode);
    setOverlayStack(defaultOverlayForMode(mode));
    if (mode === "REPAIR") {
      setCanvasTool("region");
      setRightTab("advanced");
    } else if (mode === "GENERATE") {
      setRightTab("inbetween");
    } else if (mode === "ANALYZE") {
      setRightTab("problems");
    } else if (mode === "REVIEW") {
      setFocusMode(true);
    } else {
      setFocusMode(false);
      setCanvasTool("pan");
    }
  }

  function viewProblem(peak: number, range: [number, number], category?: string) {
    setEngine((s) => seek(s, peak));
    setHighlightRange(range);
    setOverlayStack({ primary: "problems", extras: ["onion"] });
    setWorkspaceMode("ANALYZE");
    const parsePose = () => {
      const row = poses.find((p) => p.frame_number === peak);
      if (!row) return [];
      try {
        return JSON.parse(row.joints_json) as { name: string; x: number; y: number; confidence: number }[];
      } catch {
        return [];
      }
    };
    const box = locateProblemBox({
      category,
      frameNumber: peak,
      frameWidth: current?.width ?? 320,
      frameHeight: current?.height ?? 180,
      joints: parsePose(),
      tracking,
    });
    if (box) {
      setFocusRegion(box);
      setEngine((s) => setZoom(s, suggestedFocusZoom(box)));
      setFocusTick((n) => n + 1);
    }
    setProblemMenu(true);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        setEngine((s) => ({ ...s, isPlaying: !s.isPlaying }));
      } else if (e.key === "ArrowRight" || e.key === ".") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowLeft" || e.key === ",") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "Home") setEngine((s) => seek(s, 0));
      else if (e.key === "End") setEngine((s) => seek(s, s.frameCount - 1));
      else if (e.key === "k" || e.key === "K") {
        if (current && timelineId) {
          tool.mutate({
            tool: current.frameType === "KEY" ? "remove_keyframe" : "create_keyframe",
            args: { timelineId, frameNumber: current.frameNumber },
          });
        }
      } else if (e.key === "?") setHelp((h) => !h);
      else if (e.key === "o" || e.key === "O") setEngine((s) => setOnionSkin(s, { enabled: !s.onionSkin.enabled }));
      else if (e.key === "l" || e.key === "L") {
        setEngine((s) =>
          s.loopRange ? setLoopRange(s, null) : setLoopRange(s, s.selectedRange ?? [0, Math.max(0, s.frameCount - 1)]),
        );
      } else if (e.key === "b" || e.key === "B") {
        if (current && timelineId) {
          tool.mutate({ tool: "mark_breakdown", args: { timelineId, frameNumber: current.frameNumber } });
        }
      } else if (e.key === "p" || e.key === "P") setPixelView((v) => !v);
      else if (e.key === "u" || e.key === "U") {
        if (current) tool.mutate({ tool: "undo", args: { projectId, frameId: current.id } });
      } else if (e.key === "y" || e.key === "Y") {
        if (current) tool.mutate({ tool: "redo", args: { projectId, frameId: current.id } });
      } else if (e.key === "i" || e.key === "I") setSheet((v) => !v);
      else if (e.key === "f" || e.key === "F") setFocusMode((v) => !v);
      else if (e.key === "h" || e.key === "H") {
        setHoldCompare(true);
        setCompareFrame((n) => n ?? Math.max(0, engine.currentFrame - 1));
        setOverlayStack({ primary: "compare", extras: [] });
      } else if (e.key === "`") {
        setFlicker((v) => !v);
        setCompareFrame((n) => n ?? Math.max(0, engine.currentFrame - 1));
        setOverlayStack({ primary: "compare", extras: [] });
        setCompareMode("flicker");
      } else if (e.key === "a" || e.key === "A") {
        setAiOpen(true);
      } else if (e.key === "c" || e.key === "C") {
        if (timelineId) tool.mutate({ tool: "analyze_consistency", args: { timelineId } });
      } else if (e.key === "1") setMode("ANIMATE");
      else if (e.key === "2") setMode("ANALYZE");
      else if (e.key === "3") setMode("REPAIR");
      else if (e.key === "4") setMode("REVIEW");
      else if (e.key === "5") setMode("GENERATE");
      else if (e.key === "Escape") {
        setRegionLive(false);
        setProblemMenu(false);
        setAiOpen(false);
        setFocusRegion(null);
        setEngine((s) => setZoom(s, 1));
        setFitTick((n) => n + 1);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "h" || e.key === "H") setHoldCompare(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", up);
    };
  // projectId is captured by the keyboard undo/redo handlers; leaving it out
  // meant a project switch without a remount kept undoing in the old project.
  }, [current, timelineId, step, tool, engine.currentFrame, projectId]);

  const revisions = useQuery({
    queryKey: ["rev", projectId, current?.id],
    enabled: Boolean(current),
    queryFn: () => listRevisionsFn({ data: { projectId, frameId: current!.id } }),
  });

  const liveContext = {
    project_id: projectId,
    timeline_id: timelineId ?? null,
    current_frame: engine.currentFrame,
    current_frame_id: current?.id ?? null,
    selected_range:
      inb.start != null && inb.end != null ? ([inb.start, inb.end] as [number, number]) : engine.selectedRange,
    selected_frames: engine.selectedFrames,
    selected_character: selectedCharacterId,
    selected_object: selectedObjectId,
    selected_region:
      regionLive && current
        ? {
            frameId: current.id,
            frameNumber: current.frameNumber,
            x: regionBox.x / Math.max(1, current.width),
            y: regionBox.y / Math.max(1, current.height),
            width: regionBox.w / Math.max(1, current.width),
            height: regionBox.h / Math.max(1, current.height),
            selectionType: "rectangle",
          }
        : null,
    onion_skin: engine.onionSkin,
    overlay: { pose: overlayStack.primary === "pose", tracking: overlayStack.primary === "track", motion: overlayStack.primary === "motion" },
    viewport: { zoom: engine.zoom, panX: 0, panY: 0 },
    conversation_id: conversationId,
    session_id: sessionId,
    context_version: contextVersion,
  };

  const activeLive = (frozenContext as typeof liveContext | null) ?? liveContext;

  const effectiveSnap = {
    project_id: projectId,
    video_id: null,
    timeline_id: timelineId ?? null,
    current_frame: activeLive.current_frame,
    current_frame_id: activeLive.current_frame_id,
    timestamp_ms: current?.timestampMs ?? null,
    selected_range: activeLive.selected_range,
    selected_frames: activeLive.selected_frames,
    selected_character: activeLive.selected_character,
    selected_object: activeLive.selected_object,
    selected_region: activeLive.selected_region
      ? { type: "rectangle" as const, ...activeLive.selected_region, selectionType: "rectangle" as const }
      : null,
    onion_skin: {
      enabled: engine.onionSkin.enabled,
      previousFrames: engine.onionSkin.prev,
      nextFrames: engine.onionSkin.next,
      previousOpacity: engine.onionSkin.opacityPrev,
      nextOpacity: engine.onionSkin.opacityNext,
    },
    overlay: {
      pose: overlayStack.primary === "pose",
      mask: overlayStack.primary === "mask",
      tracking: overlayStack.primary === "track",
      motion: overlayStack.primary === "motion",
      depth: false,
      consistency: overlayStack.primary === "problems",
    },
    neighbors_available: true,
    analysis_available: [] as string[],
    conversation_id: conversationId,
    session_id: sessionId,
    context_version: activeLive.context_version,
    viewport: { zoom: engine.zoom },
    focus: "current_frame" as const,
  };

  function applyInbetweenPlan(d: InbetweenAskPayload, text: string) {
    const confirmation = d.confirmation;
    const plan = d.plan as InbetweenPanelState["plan"];
    const transition = d.transition;
    const strategy = d.strategy;
    const warnings = d.warnings.length ? d.warnings : confirmation?.warnings;
    const pair = d.pair;
    const intent = parseAnimationIntent(text, {
      start: confirmation?.start ?? pair?.start_frame_number ?? inb.start ?? engine.currentFrame,
      end: confirmation?.end ?? pair?.end_frame_number ?? inb.end ?? engine.currentFrame,
    });
    const flags = intentToConstraintFlags(intent);
    setInb((s) => ({
      ...s,
      busy: false,
      start: confirmation?.start ?? pair?.start_frame_number ?? intent.start_frame ?? s.start,
      end: confirmation?.end ?? pair?.end_frame_number ?? intent.end_frame ?? s.end,
      count: confirmation?.frames ?? pair?.desired_inbetween_count ?? intent.count ?? s.count,
      curve: confirmation?.curve ?? plan?.curve ?? intent.curve ?? s.curve,
      constraints: {
        preserveCharacter: flags.preserveCharacter || s.constraints.preserveCharacter,
        preserveFace: flags.preserveFace || s.constraints.preserveFace,
        preserveBackground: flags.preserveBackground || s.constraints.preserveBackground,
        maintainContact: flags.maintainContact || s.constraints.maintainContact,
        keepCameraStatic: flags.keepCameraStatic || s.constraints.keepCameraStatic,
      },
      confirmation: confirmation
        ? { ...confirmation, warnings: warnings ?? confirmation.warnings }
        : s.confirmation,
      plan: plan ?? s.plan,
      analysis: transition
        ? {
            complexity: (transition as { complexity?: string }).complexity ?? "LOW",
            score: (transition as { score?: number }).score ?? 0,
            reasons: (transition as { reasons?: string[] }).reasons ?? [],
            suggest_breakdown: Boolean(plan?.breakdowns?.length),
            suggested_breakdown: plan?.breakdowns?.[0] ?? null,
            strategy: strategy ?? { kind: "interpolation", provider: "linear-blend", reason: "" },
          }
        : s.analysis,
    }));
    setRightTab("inbetween");
    setWorkspaceMode("GENERATE");
    setAiOpen(true);
    const start = confirmation?.start ?? pair?.start_frame_number;
    const end = confirmation?.end ?? pair?.end_frame_number;
    if (typeof start === "number" && typeof end === "number") {
      setHighlightRange([start, end]);
      setEngine((st) => selectRange(st, start, end));
    }
  }

  async function sendAsk(text: string) {
    setAskBusy(true);
    setAiOpen(true);
    setAiState("analyzing");
    setChat((c) => [...c, { id: `u-${Date.now()}`, role: "user", content: text }]);
    try {
      await syncWorkspaceSessionFn({ data: { sessionId, projectId, context: activeLive } });
      const r = await sendAskFn({
        data: {
          sessionId,
          conversationId,
          providerId,
          userMessage: text,
          liveContext: {
            ...activeLive,
            selected_range:
              inb.start != null && inb.end != null
                ? [inb.start, inb.end]
                : engine.selectedRange ?? activeLive.selected_range,
          },
          fps: engine.fps,
          frameCount: engine.frameCount,
          mode: askMode,
        },
      });
      if (!r.ok) {
        toast.error(r.error);
        setAiState("idle");
        return;
      }
      setConversationId(r.conversationId);
      try {
        sessionStorage.setItem(`fl-cnv:${projectId}`, r.conversationId);
      } catch {
        /* ignore */
      }
      void qc.invalidateQueries({ queryKey: ["conversations", projectId] });
      if (r.inbetween) {
        applyInbetweenPlan(r.inbetween, text);
      } else if (r.curveAdjust) {
        const c = r.curveAdjust;
        setInb((s) => ({
          ...s,
          curve: c.curve ?? "ease_in_out",
          start: c.start ?? s.start,
          end: c.end ?? s.end,
          confirmation: {
            title: "套用運動曲線",
            start: c.start ?? s.start ?? engine.currentFrame,
            end: c.end ?? s.end ?? engine.currentFrame,
            frames: s.count,
            curve: c.curve ?? "ease_in_out",
            constraints: [],
            provider: "linear-blend",
          },
        }));
        setRightTab("inbetween");
        setWorkspaceMode("GENERATE");
        setAiState("suggestion");
      }
      const intent = parseAnimationIntent(text, {
        start: inb.start ?? engine.selectedRange?.[0] ?? engine.currentFrame,
        end: inb.end ?? engine.selectedRange?.[1] ?? engine.currentFrame,
      });
      if (isInbetweenRequest(text) && !r.inbetween) {
        setInb((s) => {
          const flags = intentToConstraintFlags(intent);
          return {
            ...s,
            start: intent.start_frame ?? s.start,
            end: intent.end_frame ?? s.end,
            count: intent.count ?? s.count,
            curve: intent.curve ?? s.curve,
            constraints: {
              preserveCharacter: flags.preserveCharacter || s.constraints.preserveCharacter,
              preserveFace: flags.preserveFace || s.constraints.preserveFace,
              preserveBackground: flags.preserveBackground || s.constraints.preserveBackground,
              maintainContact: flags.maintainContact || s.constraints.maintainContact,
              keepCameraStatic: flags.keepCameraStatic || s.constraints.keepCameraStatic,
            },
          };
        });
        setRightTab("inbetween");
      }
      if (isCurveAdjustRequest(text)) setRightTab("inbetween");
      const assist = r.assist;
      const visual = assist ? annotationsFromProblems(assist.problem_ranges ?? assist.problems ?? []) : [];
      if (visual.length) setAnnotations((a) => [...a, ...visual]);
      const range = assist?.problem_ranges?.[0];
      if (range) {
        viewProblem(range.peak_frame, [range.start, range.end], range.category);
        setRepairViz(assist.repair_plan ? assist.repair_plan.repair_range : [range.start, range.end]);
        setAiState("problem");
      } else {
        setAiState("suggestion");
      }
      setChat((c) => [
        ...c,
        {
          id: r.assistantMessageId,
          role: "assistant",
          content: r.text,
          suggestions: r.suggestions,
          assist: assist
            ? {
                summary: assist.summary,
                problem_ranges: assist.problem_ranges,
                repair_plan: assist.repair_plan,
                context_label: assist.context_label,
              }
            : undefined,
        },
      ]);
    } finally {
      setAskBusy(false);
    }
  }

  if (bundle.isLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg text-muted">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }
  if (bundle.isError) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg px-6 text-center">
        <div className="max-w-sm space-y-3">
          <p className="text-lg font-medium text-fg">工作區讀不到</p>
          <p className="text-sm text-muted">重新整理，或回到專案列表再開一次。</p>
          <Link to="/studio" className="inline-flex h-10 items-center rounded-[var(--radius-sm)] bg-accent px-4 text-sm font-medium text-accent-fg">
            回到專案列表
          </Link>
        </div>
      </div>
    );
  }
  if (!bundle.data?.ok) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg px-6 text-center">
        <div className="max-w-sm space-y-3">
          <p className="text-lg font-medium text-fg">找不到這個專案</p>
          <p className="text-sm text-muted">可能已經刪除，或這不是你的專案。回到列表再開一份，或從經典彈跳球開始。</p>
          <Link to="/studio" className="inline-flex h-10 items-center rounded-[var(--radius-sm)] bg-accent px-4 text-sm font-medium text-accent-fg">
            回到專案列表
          </Link>
        </div>
      </div>
    );
  }

  const project = bundle.data.project;
  const problemList = problemRanges.map((r, i) => ({
    i,
    label: `F${r.start}–F${r.end} ${categoryLabel(r.category)}`,
    peak: r.peak_frame,
    range: [r.start, r.end] as [number, number],
    severity: r.severity,
    reason: r.reason,
    category: r.category,
  }));
  const runningJob = jobs.find((j) => j.state === "running" || j.state === "queued");
  const chrome = chromeForMode(workspaceMode, focusMode);
  const presence = buildPresence(assignments);
  const selectedPresence = presence.find((p) => p.id === selectedCharacterId);
  const dimFrames =
    charTrack && selectedPresence
      ? new Set(frames.filter((f) => !selectedPresence.frames.has(f.frameNumber)).map((f) => f.frameNumber))
      : undefined;

  function propagateRegion() {
    const seed = { frame: engine.currentFrame, x: regionBox.x, y: regionBox.y, w: regionBox.w, h: regionBox.h };
    const start = Math.max(0, engine.currentFrame - 5);
    const end = Math.min(engine.frameCount - 1, engine.currentFrame + 5);
    const nums: number[] = [];
    for (let i = start; i <= end; i += 1) nums.push(i);
    const next = propagateMask(seed, nums, tracking);
    setMaskTrack(next.map((n) => ({ frame: n.frame, mask: n.mask, lost: n.lost, confidence: n.confidence })));
    setHighlightRange([start, end]);
    setOverlayStack({ primary: "mask", extras: ["problems"] });
    toast.message(`遮罩已套用 F${start}–F${end}`);
  }

  return (
    <div className="flex h-screen flex-col bg-bg text-fg">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <Link to="/studio" className="text-[10px] uppercase tracking-[0.18em] text-muted">
          FrameLab
        </Link>
        <span className="text-border">/</span>
        <span className="truncate text-sm">{project.name}</span>
        <span className="text-[11px] text-faint">{project.fps} fps</span>
        <div className="mx-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-8" onClick={() => setEngine((s) => seek(s, 0))} aria-label="第一格">
            <SkipBack className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={() => step(-1)} aria-label="上一格">
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="size-8"
            onClick={() => setEngine((s) => ({ ...s, isPlaying: !s.isPlaying }))}
            aria-label={engine.isPlaying ? "暫停" : "播放"}
          >
            {engine.isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={() => step(1)} aria-label="下一格">
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={() => setEngine((s) => seek(s, s.frameCount - 1))} aria-label="最後一格">
            <SkipForward className="size-4" />
          </Button>
          <span className="ml-2 font-mono text-sm tabular-nums">{padFrame(engine.currentFrame)}</span>
          <span className="text-xs text-faint">/ {padFrame(Math.max(0, engine.frameCount - 1))}</span>
          <select
            className="ml-2 h-7 rounded-[var(--radius-xs)] border border-border bg-subtle px-1 text-[11px] text-fg"
            value={playbackSpeed}
            onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
          >
            {PLAYBACK_SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </div>
        <div className="hidden items-center gap-0.5 md:flex">
          {(["ANIMATE", "ANALYZE", "REPAIR", "REVIEW", "GENERATE"] as WorkspaceMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "rounded-[var(--radius-xs)] px-2 py-1 text-[10px] uppercase tracking-wide",
                workspaceMode === m ? "bg-raised text-fg" : "text-faint hover:text-fg",
              )}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <Button variant={engine.onionSkin.enabled ? "secondary" : "ghost"} size="sm" onClick={() => setEngine((s) => setOnionSkin(s, { enabled: !s.onionSkin.enabled }))}>
          <FlipHorizontal className="size-3.5" />
          洋蔥皮
        </Button>
        <Button
          variant={engine.loopRange ? "secondary" : "ghost"}
          size="sm"
          onClick={() =>
            setEngine((s) =>
              s.loopRange ? setLoopRange(s, null) : setLoopRange(s, s.selectedRange ?? [0, Math.max(0, s.frameCount - 1)]),
            )
          }
        >
          <Repeat className="size-3.5" />
          循環
        </Button>
        <Button
          variant={flicker ? "secondary" : "ghost"}
          size="sm"
          onClick={() => {
            setFlicker((v) => !v);
            setCompareFrame((n) => n ?? Math.max(0, engine.currentFrame - 1));
            setOverlayStack({ primary: "compare", extras: [] });
            setCompareMode("flicker");
          }}
        >
          閃爍比對
        </Button>
        <Button variant={focusMode ? "secondary" : "ghost"} size="sm" onClick={() => setFocusMode((v) => !v)}>
          對焦
        </Button>
        <Button variant="ghost" size="icon" className="size-8" onClick={() => setHelp(true)} aria-label="快捷鍵">
          <Keyboard className="size-4" />
        </Button>
        <UserButton />
      </header>

      {runningJob && (
        <div className="border-b border-border bg-subtle px-3 py-1 text-[11px] text-muted">
          {jobStageLabel(runningJob.type, runningJob.state, runningJob.progress, parseJobStage(runningJob.result_json))}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {chrome.left && (
          <aside className="hidden w-[148px] shrink-0 overflow-y-auto border-r border-border bg-surface p-2 text-[11px] md:block">
            <p className="px-1 text-[10px] uppercase tracking-wide text-faint">圖層</p>
            {characters.length === 0 && objects.length === 0 && (
              <p className="mt-1 px-1 text-[10px] text-faint">尚未選取角色或物件</p>
            )}
            {characters.map((c) => {
              const on = selectedCharacterId === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  className="mt-1 flex w-full items-center justify-between rounded-[var(--radius-xs)] px-1.5 py-1 text-left text-muted hover:bg-raised hover:text-fg"
                  onClick={() => {
                    setSelectedCharacterId(on ? null : c.id);
                    setCharTrack(!on);
                  }}
                >
                  <span>{c.name}</span>
                  {on && charTrack ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                </button>
              );
            })}
            {objects.map((o) => {
              const on = selectedObjectId === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  className="mt-1 flex w-full items-center justify-between rounded-[var(--radius-xs)] px-1.5 py-1 text-left text-muted hover:bg-raised hover:text-fg"
                  onClick={() => setSelectedObjectId(on ? null : o.id)}
                >
                  <span>{o.name}</span>
                  {on ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                </button>
              );
            })}
            {[
              { id: "pose" as const, label: "姿態" },
              { id: "motion" as const, label: "運動" },
              { id: "problems" as const, label: "問題" },
            ].map((l) => {
              const on = overlayStack.primary === l.id || overlayStack.extras.includes(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  className="mt-1 flex w-full items-center justify-between rounded-[var(--radius-xs)] px-1.5 py-1 text-left text-muted hover:bg-raised hover:text-fg"
                  onClick={() => setOverlayStack((s) => setPrimary(s, l.id))}
                >
                  <span>{l.label}</span>
                  {on ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                </button>
              );
            })}
            <p className="mt-3 px-1 text-[10px] uppercase tracking-wide text-faint">軌跡</p>
            {TRAIL_TARGETS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTrailTarget(t);
                  setOverlayStack((s) => setPrimary(s, "track"));
                  if (t === "right_hand") setSelectedJoint("right_wrist");
                  if (t === "left_hand") setSelectedJoint("left_wrist");
                  if (t === "head") setSelectedJoint("nose");
                }}
                className={cn("mt-0.5 block w-full rounded-[var(--radius-xs)] px-1.5 py-0.5 text-left", trailTarget === t ? "bg-raised text-fg" : "text-faint")}
              >
                {TRAIL_ZH[t]}
              </button>
            ))}
            <p className="mt-3 px-1 text-[10px] uppercase tracking-wide text-faint">工具</p>
            {(["pan", "region", "point", "character"] as CanvasTool[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setCanvasTool(t)}
                className={cn("mt-0.5 block w-full rounded-[var(--radius-xs)] px-1.5 py-0.5 text-left", canvasTool === t ? "bg-raised text-fg" : "text-faint")}
              >
                {TOOL_LABEL[t]}
              </button>
            ))}
            {charTrack && selectedCharacterId && <p className="mt-3 px-1 text-[10px] text-faint">角色軌道開啟 — 沒有此角色的影格會變暗。</p>}
          </aside>
        )}

        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
          <div className="relative min-h-0 min-w-0 flex-1">
            <AnimationCanvas
              frames={frames}
              imageMap={imageMap}
              engine={engine}
              overlay={overlayStack}
              consMap={consMap}
              tracking={tracking}
              poses={poses}
              annotations={annotations}
              pixelView={pixelView}
              regionBox={regionBox}
              regionLive={regionLive}
              tool={canvasTool}
              trailTarget={trailTarget}
              selectedJoint={selectedJoint}
              compareFrame={compareFrame}
              flickerOn={flicker}
              compareMode={compareMode}
              holdCompare={holdCompare}
              candidatePreview={(() => {
                const slot = inb.candidate?.frames.find((f) => f.frameNumber === engine.currentFrame);
                const data = slot?.imageData || slot?.thumbnailData;
                return data ? { frameNumber: engine.currentFrame, data } : null;
              })()}
              compareSources={compareSources}
              revisionPreview={revisionPreview}
              maskTrack={maskTrack}
              focusRegion={focusRegion}
              focusTick={focusTick}
              onZoom={(z) => setEngine((s) => setZoom(s, z))}
              onRegion={commitRegion}
              onAnnotationClick={(a) => {
                setEngine((s) => seek(s, a.frame_number));
                if (a.type === "RANGE" && a.coordinates.length >= 2) setHighlightRange([a.coordinates[0], a.coordinates[1]]);
                setProblemMenu(true);
              }}
              onProblemBubble={() => setProblemMenu(true)}
              fitTick={fitTick}
              onPlacePoint={(x, y) => {
                if (!current) return;
                if (canvasTool === "region") return;
                if (canvasTool === "character") {
                  if (selectedCharacterId) {
                    tool.mutate({ tool: "assign_character", args: { frameId: current.id, characterId: selectedCharacterId } });
                  } else {
                    toast.message("請先在圖層選取角色，或到進階面板新增角色");
                  }
                }
                tool.mutate({
                  tool: "create_tracking_point",
                  args: {
                    projectId,
                    name:
                      canvasTool === "character"
                        ? (characters.find((c) => c.id === selectedCharacterId)?.name ?? `pt-${engine.currentFrame}`)
                        : `pt-${engine.currentFrame}`,
                    x,
                    y,
                    frameNumber: engine.currentFrame,
                  },
                });
              }}
            />
            {frames.length === 0 && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center bg-bg/80 px-6 text-center">
                <div>
                  <p className="text-sm text-fg">還沒有影格</p>
                  <p className="mt-1 text-[12px] text-muted">回到專案列表匯入序列，或開啟經典彈跳球。</p>
                </div>
              </div>
            )}
            <RegionActions
              visible={regionLive && chrome.regionActions}
              frame={engine.currentFrame}
              onAnalyze={() => {
                setAiOpen(true);
                void sendAsk("這裡為什麼怪怪的？");
              }}
              onTrack={() => {
                if (!current) return;
                const nx = regionBox.x + regionBox.w / 2;
                const ny = regionBox.y + regionBox.h / 2;
                tool.mutate({
                  tool: "create_tracking_point",
                  args: { projectId, name: regionKind === "custom" ? `region-${engine.currentFrame}` : regionKind, x: nx, y: ny, frameNumber: engine.currentFrame },
                });
              }}
              onRepair={() => {
                if (!current) return;
                setRepairViz([engine.currentFrame, engine.currentFrame]);
                setWorkspaceMode("REPAIR");
                tool.mutate({
                  tool: "regenerate_region",
                  args: { frameId: current.id, region: regionKind, method: "blend", x: regionBox.x, y: regionBox.y, w: regionBox.w, h: regionBox.h },
                });
              }}
              onPropagate={propagateRegion}
              onClear={() => {
                setRegionLive(false);
                setMaskTrack([]);
              }}
            />
            {problemMenu && (
              <div className="absolute right-3 top-3 z-20 w-56 rounded-[var(--radius-sm)] border border-border bg-surface p-2 text-[11px] shadow-[var(--shadow-panel)]">
                <p className="text-fg">F{engine.currentFrame} 問題</p>
                <p className="mt-1 text-faint">{problemList.find((p) => p.peak === engine.currentFrame)?.reason ?? "跳鄰近格、詢問，或規劃修復。"}</p>
                <div className="mt-2 flex flex-col gap-1">
                  <Button size="sm" variant="ghost" onClick={() => { setCompareFrame(Math.max(0, engine.currentFrame - 1)); setFlicker(true); setOverlayStack({ primary: "compare", extras: [] }); }}>
                    鄰近格
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setAiOpen(true); void sendAsk("這裡為什麼怪怪的？"); }}>
                    問 AI
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const p = problemList.find((x) => x.peak === engine.currentFrame);
                      setRepairViz(p ? p.range : [engine.currentFrame, engine.currentFrame]);
                      setWorkspaceMode("REPAIR");
                      setProblemMenu(false);
                    }}
                  >
                    規劃修復
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setFocusRegion(null);
                      setEngine((s) => setZoom(s, 1));
                      setFitTick((n) => n + 1);
                      setProblemMenu(false);
                    }}
                  >
                    回到符合畫面
                  </Button>
                </div>
              </div>
            )}
            {overlayStack.primary === "compare" && (
              <div className="absolute left-3 top-3 z-10 flex gap-1 rounded-[var(--radius-sm)] border border-border bg-surface/90 p-1">
                {(["flicker", "side", "overlay", "diff", "hold"] as CompareMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setCompareMode(m);
                      setFlicker(m === "flicker");
                      setHoldCompare(m === "hold");
                      setCompareFrame((n) => n ?? Math.max(0, engine.currentFrame - 1));
                    }}
                    className={cn("rounded-[var(--radius-xs)] px-2 py-0.5 text-[10px]", compareMode === m ? "bg-raised text-fg" : "text-faint")}
                  >
                    {m === "side" ? "並排" : m === "diff" ? "差異" : m === "hold" ? "長按" : m === "flicker" ? "閃爍" : "疊加"}
                  </button>
                ))}
              </div>
            )}
            {chrome.onionPeek && engine.onionSkin.enabled && (
              <div className="pointer-events-auto absolute bottom-3 left-3 flex items-end gap-1.5">
                {[
                  { label: "前 3", n: engine.currentFrame - 3 },
                  { label: "−2", n: engine.currentFrame - 2 },
                  { label: "−1", n: engine.currentFrame - 1 },
                  { label: "現在", n: engine.currentFrame },
                  { label: "+1", n: engine.currentFrame + 1 },
                  { label: "+2", n: engine.currentFrame + 2 },
                  { label: "後 3", n: engine.currentFrame + 3 },
                ].map((s) => {
                  const f = frames.find((x) => x.frameNumber === s.n);
                  const src = f ? jpegUrl(imageMap.get(f.id) || f.thumbnailData || "") : "";
                  return (
                    <button
                      key={s.label}
                      type="button"
                      disabled={!f}
                      onClick={() => f && setEngine((st) => seek(st, s.n))}
                      className={cn("flex flex-col items-center gap-0.5", s.n === engine.currentFrame ? "text-fg" : "text-faint")}
                    >
                      <span className="text-[9px] uppercase tracking-wide">{s.label}</span>
                      <span className={cn("block h-8 w-12 overflow-hidden rounded-[var(--radius-xs)] border", s.n === engine.currentFrame ? "border-accent" : "border-border")}>
                        {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {repairViz && workspaceMode === "REPAIR" && (
              <div className="absolute left-3 top-3 z-10 rounded-[var(--radius-sm)] border border-repair/40 bg-surface/90 px-2 py-1 text-[11px]">
                只會改 F{repairViz[0]}{repairViz[0] !== repairViz[1] ? `–F${repairViz[1]}` : ""}。
              </div>
            )}
          </div>
          {aiOpen && chrome.ai ? (
            <div className="fixed inset-x-0 bottom-0 z-30 flex h-[70vh] w-full flex-col md:relative md:h-full md:w-[320px] md:shrink-0">
            <ConversationPanel
              open
              docked
              onClose={() => setAiOpen(false)}
              onMinimize={() => setAiOpen(false)}
              providers={llm.data ?? []}
              providerId={providerId}
              onProvider={setProviderId}
              chips={chipsFromSnapshot(
                effectiveSnap,
                characters.find((c) => c.id === selectedCharacterId)?.name,
              )}
              following={!contextLocked}
              lockLabel="已鎖定上下文"
              onToggleLock={() => {
                if (contextLocked) {
                  setFrozenContext(null);
                  setContextLocked(false);
                  if (conversationId) {
                    void setConversationLockFn({ data: { conversationId, locked: false } });
                  }
                } else {
                  setFrozenContext({ ...liveContext });
                  setContextLocked(true);
                  if (conversationId) {
                    void setConversationLockFn({
                      data: { conversationId, locked: true, snapshotJson: JSON.stringify(liveContext) },
                    });
                  }
                }
              }}
              messages={chat}
              sending={askBusy}
              toolStatus={askBusy ? "正在看鄰近影格…" : null}
              stale={false}
              onSend={sendAsk}
              onViewRange={(a, b, peak) => viewProblem(peak, [a, b])}
              onSuggestion={(act) => {
                if (act.frame_range) {
                  setHighlightRange(act.frame_range);
                  setEngine((s) => selectRange(s, act.frame_range![0], act.frame_range![1]));
                  setInb((s) => ({ ...s, start: act.frame_range![0], end: act.frame_range![1] }));
                }
                if (act.action === "CREATE_REPAIR_PLAN" && timelineId) {
                  tool.mutate({
                    tool: "create_repair_plan",
                    args: { timelineId, startFrame: act.frame_range?.[0], endFrame: act.frame_range?.[1] },
                  });
                }
                if (
                  (act.action === "CREATE_INBETWEEN_PLAN" ||
                    act.action === "GENERATE_INBETWEENS" ||
                    act.action === "APPLY_CURVE") &&
                  timelineId
                ) {
                  const start = act.frame_range?.[0] ?? inb.start;
                  const end = act.frame_range?.[1] ?? inb.end;
                  if (start == null || end == null) {
                    toast.error("請先設定起點與終點關鍵影格");
                    return;
                  }
                  setWorkspaceMode("GENERATE");
                  setRightTab("inbetween");
                  setInb((s) => ({
                    ...s,
                    start,
                    end,
                    curve: act.action === "APPLY_CURVE" ? "ease_in_out" : s.curve,
                    busy: true,
                  }));
                  tool.mutate({
                    tool: "create_inbetween_plan",
                    args: {
                      timelineId,
                      startFrame: start,
                      endFrame: end,
                      count: inb.count,
                      curve: act.action === "APPLY_CURVE" ? "ease_in_out" : inb.curve,
                      promoteKeys: true,
                      ...inb.constraints,
                    },
                  });
                }
                if (act.action === "SUGGEST_BREAKDOWN" && timelineId) {
                  const n =
                    typeof act.frame === "number"
                      ? act.frame
                      : act.frame_range
                        ? Math.round((act.frame_range[0] + act.frame_range[1]) / 2)
                        : engine.currentFrame;
                  tool.mutate({ tool: "mark_breakdown", args: { timelineId, frameNumber: n } });
                }
              }}
              providerStatus={llm.data?.find((p) => p.id === providerId)?.status === "ready" ? "ready" : "NOT_CONFIGURED"}
              mode={askMode}
              onMode={setAskMode}
            />
            </div>
          ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-border bg-surface px-2 py-1 scrollbar-thin">
            {MODE_BAR.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={(e) => {
                  if (e.shiftKey) setOverlayStack((s) => toggleExtra(s, o.id));
                  else setOverlayStack((s) => setPrimary(s, o.id));
                  if (o.id === "compare") setCompareFrame((n) => n ?? Math.max(0, engine.currentFrame - 1));
                }}
                className={cn(
                  "rounded-[var(--radius-xs)] px-2 py-1 text-[11px]",
                  overlayStack.primary === o.id ? "bg-raised text-fg" : overlayStack.extras.includes(o.id) ? "text-fg" : "text-muted hover:text-fg",
                )}
              >
                {o.label}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="icon" className="size-8" onClick={() => setEngine((s) => setZoom(s, s.zoom / 1.2))} aria-label="縮小">
                <ZoomOut className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => {
                  setFocusRegion(null);
                  setEngine((s) => setZoom(s, 1));
                  setFitTick((n) => n + 1);
                }}
                aria-label="符合畫面"
              >
                <ScanSearch className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" className="size-8" onClick={() => setEngine((s) => setZoom(s, s.zoom * 1.2))} aria-label="放大">
                <ZoomIn className="size-4" />
              </Button>
              <Button
                variant={pixelView ? "secondary" : "ghost"}
                size="sm"
                onClick={() => {
                  setPixelView((v) => !v);
                  if (!current) return;
                  const z = zoom100Percent(Math.max(320, window.innerWidth - 360), Math.max(180, window.innerHeight - 220), current.width, current.height);
                  setFocusRegion(null);
                  setEngine((s) => setZoom(s, z));
                }}
              >
                100%
              </Button>
            </div>
          </div>

          <VisualTimeline
            frames={frames}
            engine={engine}
            timelineZoom={timelineZoom}
            consMap={consMap}
            problemRanges={problemRanges}
            highlightRange={highlightRange ?? engine.selectedRange}
            repairRange={repairViz}
            maskTrack={maskTrackMarks(maskTrack)}
            dimFrames={dimFrames}
            conversationFrames={conversationFrames}
            onConversation={openConversationAtFrame}
            onSeek={(n, shift) => setEngine((s) => (shift ? selectRange(s, s.currentFrame, n) : seek(s, n)))}
            onScrub={(n) => setEngine((s) => seek(s, n))}
            onZoomTimeline={setTimelineZoom}
          />
          <SpacingStrip dots={spacingDots(inb.count, inb.curve)} caption={curveCaption(inb.curve)} />
        </div>

        {chrome.right && (
          <aside
            className={cn(
              "border-border bg-surface text-sm",
              "md:relative md:flex md:w-[280px] md:shrink-0 md:flex-col md:overflow-y-auto md:border-l",
              sheet
                ? "fixed inset-x-0 bottom-0 z-30 max-h-[75vh] overflow-y-auto rounded-t-[var(--radius-lg)] border-t p-3 md:static md:max-h-none md:rounded-none"
                : "hidden md:flex",
            )}
          >
            <div className="flex gap-1 border-b border-border p-2">
              {(["problems", "inbetween", "advanced"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setRightTab(t)}
                  className={cn("rounded-[var(--radius-xs)] px-2 py-1 text-[10px] tracking-wide", rightTab === t ? "bg-raised text-fg" : "text-faint")}
                >
                  {t === "problems" ? "問題" : t === "inbetween" ? "中間影格" : "進階"}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {rightTab === "problems" && (
                <div className="space-y-3">
                  <ProblemNavigator
                    items={problemList}
                    filter={problemFilter}
                    onFilter={setProblemFilter}
                    onSelect={(p) => viewProblem(p.peak, p.range, p.category)}
                    onScan={() => timelineId && tool.mutate({ tool: "analyze_consistency", args: { timelineId } })}
                    busy={tool.isPending}
                  />
                  {repairViz && (
                    <div className="rounded-[var(--radius-sm)] border border-repair/40 p-2 text-[11px]">
                      <p>修復範圍 F{repairViz[0]}–F{repairViz[1]}</p>
                      <p className="text-faint">受保護的關鍵影格不動，只改中間影格。</p>
                      <Button
                        size="sm"
                        className="mt-2"
                        disabled={!timelineId}
                        onClick={() => {
                          if (repairPlanId) {
                            tool.mutate({ tool: "execute_repair_plan", args: { planId: repairPlanId, confirmed: true } });
                            return;
                          }
                          if (!timelineId) return;
                          tool.mutate({
                            tool: "repair_frame_range",
                            args: { timelineId, startFrame: repairViz[0], endFrame: repairViz[1], confirmed: true },
                          });
                        }}
                      >
                        <Wand2 className="size-3.5" />
                        確認修復
                      </Button>
                    </div>
                  )}
                  <ConsistencyStrips
                    frames={frames}
                    imageMap={imageMap}
                    consMap={consMap}
                    poses={poses}
                    tracking={tracking}
                    onSeek={(n) => setEngine((s) => seek(s, n))}
                  />
                  <CharacterBoard
                    characters={characters}
                    selectedId={selectedCharacterId}
                    assignments={assignments}
                    frames={frames}
                    imageMap={imageMap}
                    onSelect={(id) => {
                      setSelectedCharacterId(id);
                      setCharTrack(Boolean(id));
                    }}
                    onSeek={(n) => setEngine((s) => seek(s, n))}
                  />
                  <div className="mt-3">
                    <p className="text-[10px] uppercase tracking-wide text-faint">AI 對話 {conversationCounts[engine.currentFrame] ? "💬" : ""}</p>
                    {conversationId ? (
                      <button
                        type="button"
                        className="mt-1 text-[11px] text-accent"
                        onClick={() => onOpenConversation(conversationId)}
                      >
                        重開此影格的對話
                      </button>
                    ) : (
                      <button type="button" className="mt-1 text-[11px] text-accent" onClick={openThread}>
                        問這一格
                      </button>
                    )}
                  </div>
                  <ContextInspector snapshot={effectiveSnap} />
                  <RegionSelectorStatus
                    region={regionLive ? effectiveSnap.selected_region : null}
                    onClear={() => setRegionLive(false)}
                  />
                  {revisionPreview && (
                    <p className="text-[11px] text-warn">
                      正在預覽修訂，尚未寫入時間軸。
                      <button type="button" className="ml-2 text-accent" onClick={() => setRevisionPreview(null)}>
                        關閉預覽
                      </button>
                    </p>
                  )}
                  {regionMode && <p className="text-[10px] text-faint">選區工具 — 在畫布上拖曳。</p>}
                </div>
              )}
              {rightTab === "inbetween" && (
                <div className="space-y-3">
                  {workspaceMode === "GENERATE" && (
                    <div className="rounded-[var(--radius-sm)] border border-border p-2 text-[11px] text-muted">
                      <p className="text-[10px] uppercase tracking-wide text-faint">生成流程</p>
                      <div className="mt-1 flex items-center gap-1 overflow-x-auto">
                        <span className="font-mono text-key">★ F{inb.start ?? "—"}</span>
                        <span className="text-faint">→</span>
                        {(inb.candidate?.frames ?? []).slice(0, 8).map((f) => (
                          <button
                            key={f.frameNumber}
                            type="button"
                            className="h-8 w-8 overflow-hidden rounded-[var(--radius-xs)] border border-gen/40"
                            onClick={() => setEngine((s) => seek(s, f.frameNumber))}
                          >
                            {f.thumbnailData ? (
                              <img
                                src={f.thumbnailData.startsWith("data:") ? f.thumbnailData : `data:image/jpeg;base64,${f.thumbnailData}`}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <span className="grid h-full place-items-center text-[8px] text-gen">G</span>
                            )}
                          </button>
                        ))}
                        <span className="text-faint">→</span>
                        <span className="font-mono text-key">★ F{inb.end ?? "—"}</span>
                      </div>
                    </div>
                  )}
                  <InbetweenPanel
                    currentFrame={engine.currentFrame}
                    selectedRange={engine.selectedRange}
                    state={inb}
                    onCount={(n) => setInb((s) => ({ ...s, count: n }))}
                    onCurve={(c) => setInb((s) => ({ ...s, curve: c }))}
                    onQuality={(q) => setInb((s) => ({ ...s, quality: q }))}
                    onConstraint={(k, v) => setInb((s) => ({ ...s, constraints: { ...s.constraints, [k]: v } }))}
                    onSetStart={() => {
                      setInb((s) => ({ ...s, start: engine.currentFrame }));
                      if (timelineId) {
                        tool.mutate({
                          tool: "set_frame_type",
                          args: { timelineId, frameNumber: engine.currentFrame, frameType: "KEY" },
                        });
                      }
                    }}
                    onSetEnd={() => {
                      setInb((s) => ({ ...s, end: engine.currentFrame }));
                      if (timelineId) {
                        tool.mutate({
                          tool: "set_frame_type",
                          args: { timelineId, frameNumber: engine.currentFrame, frameType: "KEY" },
                        });
                      }
                    }}
                    onUseRange={() =>
                      engine.selectedRange && setInb((s) => ({ ...s, start: engine.selectedRange![0], end: engine.selectedRange![1] }))
                    }
                    onAnalyze={() => {
                      if (!timelineId || inb.start == null || inb.end == null) return toast.error("請先設定起點與終點關鍵影格");
                      setInb((s) => ({ ...s, busy: true }));
                      tool.mutate({
                        tool: "create_inbetween_plan",
                        args: { timelineId, startFrame: inb.start, endFrame: inb.end, count: inb.count, curve: inb.curve, promoteKeys: true, ...inb.constraints },
                      });
                    }}
                    onPlan={() => {
                      if (!timelineId || inb.start == null || inb.end == null) return;
                      setInb((s) => ({ ...s, busy: true }));
                      tool.mutate({
                        tool: "create_inbetween_plan",
                        args: { timelineId, startFrame: inb.start, endFrame: inb.end, count: inb.count, curve: inb.curve, promoteKeys: true, ...inb.constraints },
                      });
                    }}
                    onConfirmGenerate={() => {
                      if (!timelineId || inb.start == null || inb.end == null) return;
                      setInb((s) => ({ ...s, busy: true }));
                      tool.mutate({
                        tool: "generate_inbetweens",
                        args: {
                          timelineId,
                          frameA: inb.start,
                          frameB: inb.end,
                          count: inb.count,
                          curve: inb.curve,
                          provider: "linear-blend",
                          confirmed: true,
                          quality: inb.quality,
                          ...inb.constraints,
                        },
                      });
                    }}
                    onForceGenerate={() => {
                      if (!timelineId || inb.start == null || inb.end == null) return;
                      setInb((s) => ({ ...s, busy: true }));
                      tool.mutate({
                        tool: "generate_inbetweens",
                        args: {
                          timelineId,
                          frameA: inb.start,
                          frameB: inb.end,
                          count: inb.count,
                          curve: inb.curve,
                          confirmed: true,
                          force: true,
                          ...inb.constraints,
                        },
                      });
                    }}
                    onCancelConfirm={() => setInb((s) => ({ ...s, confirmation: null }))}
                    onAccept={() => {
                      if (!inb.candidate) return;
                      tool.mutate({ tool: "accept_generated_frames", args: { candidateId: inb.candidate.candidateId, confirmed: true } });
                    }}
                    onReject={() => {
                      if (!inb.candidate) return;
                      tool.mutate({ tool: "reject_generated_frames", args: { candidateId: inb.candidate.candidateId } });
                    }}
                    onRegenerate={() => {
                      if (!inb.candidate) return;
                      tool.mutate({ tool: "regenerate_inbetween_range", args: { candidateId: inb.candidate.candidateId, confirmed: true } });
                    }}
                    onMarkBreakdown={(n) => timelineId && tool.mutate({ tool: "mark_breakdown", args: { timelineId, frameNumber: n } })}
                    onViewCandidate={() => {
                      const first = inb.candidate?.frames[0];
                      if (typeof first?.frameNumber === "number") setEngine((s) => seek(s, first.frameNumber));
                      const orig = first ? frames.find((f) => f.frameNumber === first.frameNumber) : current;
                      const prev = inb.candidate?.previousFrames?.find((f) => f.frameNumber === first?.frameNumber) ?? inb.candidate?.previousFrames?.[0];
                      setCompareSources({
                        original: orig ? imageMap.get(orig.id) || orig.thumbnailData : null,
                        candidate: first?.imageData || first?.thumbnailData || null,
                        previous: prev?.imageData || prev?.thumbnailData || null,
                      });
                      setOverlayStack({ primary: "compare", extras: [] });
                      setCompareMode("side");
                    }}
                    onSeekCandidate={(n) => {
                      setEngine((s) => seek(s, n));
                      const orig = frames.find((f) => f.frameNumber === n);
                      const cand = inb.candidate?.frames.find((f) => f.frameNumber === n);
                      const prev = inb.candidate?.previousFrames?.find((f) => f.frameNumber === n);
                      setCompareSources({
                        original: orig ? imageMap.get(orig.id) || orig.thumbnailData : null,
                        candidate: cand?.imageData || cand?.thumbnailData || null,
                        previous: prev?.imageData || prev?.thumbnailData || null,
                      });
                      setOverlayStack({ primary: "compare", extras: ["onion"] });
                    }}
                    onCompareCandidates={() => {
                      const prev = inb.candidate?.previousFrames?.[0];
                      const now = inb.candidate?.frames[0];
                      const orig = now ? frames.find((f) => f.frameNumber === now.frameNumber) : current;
                      if (typeof now?.frameNumber === "number") setEngine((s) => seek(s, now.frameNumber));
                      setCompareSources({
                        original: orig ? imageMap.get(orig.id) || orig.thumbnailData : null,
                        candidate: now?.imageData || now?.thumbnailData || null,
                        previous: prev?.imageData || prev?.thumbnailData || null,
                      });
                      setOverlayStack({ primary: "compare", extras: [] });
                      setCompareMode("side");
                    }}
                    onExportSequence={() => {
                      void exportPngSequence(frames, imageMap, inb.candidate?.frames);
                    }}
                    onRenderPreview={() => {
                      void exportWebm(frames, imageMap, project.fps);
                    }}
                  />
                  {inb.plan && (
                    <svg viewBox="0 0 120 48" className="h-12 w-full text-muted">
                      <path d={curvePathD(inb.curve)} fill="none" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                  )}
                  <MotionPlanVisual plan={inb.plan} />
                  <ConstraintChips constraints={inb.constraints} />
                </div>
              )}
              {rightTab === "advanced" && current && (
                <AdvancedInspector
                  current={current}
                  onion={engine.onionSkin}
                  setOnion={(p) => setEngine((s) => setOnionSkin(s, p))}
                  cons={consMap.get(current.frameNumber)}
                  characters={characters}
                  objects={objects}
                  tracking={tracking}
                  jobs={jobs}
                  revisions={(revisions.data ?? []).map((r) => ({
                    ...r,
                    previewData: previewFromRevision(r),
                  }))}
                  busy={tool.isPending}
                  regionBox={regionBox}
                  setRegionBox={setRegionBox}
                  regionKind={regionKind}
                  setRegionKind={setRegionKind}
                  onType={(frameType) => timelineId && tool.mutate({ tool: "set_frame_type", args: { timelineId, frameNumber: current.frameNumber, frameType } })}
                  onDuration={(durationMs) => tool.mutate({ tool: "set_frame_duration", args: { frameId: current.id, durationMs } })}
                  onExposure={(n) => tool.mutate({ tool: "set_frame_exposure", args: { frameId: current.id, exposure: n } })}
                  onLock={async (locked) => {
                    await setLockedFn({ data: { frameId: current.id, locked } });
                    refresh();
                  }}
                  onNotes={async (notes) => updateNotesFn({ data: { frameId: current.id, notes } })}
                  onAnalyze={() => timelineId && tool.mutate({ tool: "analyze_frame", args: { timelineId, frameNumber: current.frameNumber, vlm: true } })}
                  onMotion={() => timelineId && tool.mutate({ tool: "analyze_motion", args: { timelineId } })}
                  onTrack={() => timelineId && tool.mutate({ tool: "analyze_tracking", args: { timelineId } })}
                  onPose={() => timelineId && tool.mutate({ tool: "analyze_pose", args: { timelineId } })}
                  onRepair={() => tool.mutate({ tool: "repair_frame", args: { frameId: current.id, method: "blend" } })}
                  onRepairRegion={() => {
                    if (!regionLive || regionBox.w < 8 || regionBox.h < 8) {
                      toast.error("請先在畫布上拖出真實選區");
                      return;
                    }
                    tool.mutate({
                      tool: "regenerate_region",
                      args: { frameId: current.id, region: regionKind, method: "blend", x: regionBox.x, y: regionBox.y, w: regionBox.w, h: regionBox.h },
                    });
                  }}
                  onDuplicate={() => tool.mutate({ tool: "duplicate_frame", args: { frameId: current.id } })}
                  onDelete={() => tool.mutate({ tool: "delete_frame", args: { frameId: current.id } })}
                  onUndo={() => tool.mutate({ tool: "undo", args: { projectId, frameId: current.id } })}
                  onRedo={() => tool.mutate({ tool: "redo", args: { projectId, frameId: current.id } })}
                  onPreview={(id, data) => {
                    if (data) {
                      setRevisionPreview({ frameNumber: current.frameNumber, data });
                      toast.message("修訂預覽 — 尚未寫入時間軸");
                    } else {
                      toast.message("這筆修訂沒有可預覽的影像");
                    }
                  }}
                  onRestore={(id) => {
                    setRevisionPreview(null);
                    void restoreRevisionFn({ data: { revisionId: id } }).then(refresh);
                  }}
                  onExport={() => void exportWebm(frames, imageMap, project.fps)}
                  onCreateCharacter={(name) => tool.mutate({ tool: "create_character", args: { projectId, name } })}
                  onAssign={(id) => {
                    setSelectedCharacterId(id);
                    tool.mutate({ tool: "assign_character", args: { frameId: current.id, characterId: id } });
                  }}
                  onCreateObject={(name) => tool.mutate({ tool: "create_object", args: { projectId, name } })}
                  onAssignObject={(id) => {
                    setSelectedObjectId(id);
                    tool.mutate({ tool: "assign_object", args: { frameId: current.id, objectId: id } });
                  }}
                  onDetectKeys={() => timelineId && tool.mutate({ tool: "detect_keyframes", args: { timelineId } })}
                />
              )}
            </div>
          </aside>
        )}
      </div>

      {!aiOpen && chrome.ai && (
        <button
          type="button"
          onClick={() => setAiOpen(true)}
          className="fixed bottom-4 right-4 z-30 flex h-11 items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 text-sm shadow-[var(--shadow-panel)]"
          aria-label="開啟 AI"
        >
          <MessageSquare className="size-4" />
          AI
          <span
            className={cn(
              "size-1.5 rounded-full",
              aiState === "problem" ? "bg-warn" : aiState === "analyzing" ? "bg-gen animate-pulse" : "bg-good/70",
            )}
          />
        </button>
      )}

      {help && (
        <button type="button" className="fixed inset-0 z-40 grid place-items-center bg-bg/70" onClick={() => setHelp(false)}>
          <div className="w-[min(440px,92vw)] rounded-[var(--radius-md)] border border-border bg-surface p-5 text-left text-sm">
            <p className="font-medium">快捷鍵</p>
            <ul className="mt-3 space-y-1 text-muted">
              <li>空白鍵 — 播放／暫停 · ← → 或 , . — 翻頁</li>
              <li>K 關鍵影格 · B 分解影格 · O 洋蔥皮 · L 循環 · P 像素</li>
              <li>A 開啟 AI · C 一致性掃描</li>
              <li>U 復原 · Y 重做 · F 對焦 · ` 閃爍比對 · 按住 H</li>
              <li>1–5 工作模式 · Shift 點疊加層可堆疊</li>
              <li>選區工具 — 在畫布上拖出問題區域</li>
              <li>Esc — 清除選區／回到符合畫面</li>
            </ul>
          </div>
        </button>
      )}
    </div>
  );
}

async function exportWebm(
  frames: { id: string; durationMs: number; width: number; height: number }[],
  imageMap: Map<string, string>,
  fps: number,
) {
  if (frames.length === 0) {
    toast.error("沒有影格");
    return;
  }
  const first = frames[0];
  const canvas = document.createElement("canvas");
  canvas.width = first.width;
  canvas.height = first.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const stream = canvas.captureStream(Math.max(1, fps));
  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
  const rec = new MediaRecorder(stream, { mimeType: mime });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "framelab.webm";
    a.click();
  };
  rec.start();
  for (const f of frames) {
    const src = imageMap.get(f.id);
    if (!src) continue;
    const img = new Image();
    img.src = jpegUrl(src);
    await new Promise((res) => {
      img.onload = res;
      img.onerror = res;
    });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    await new Promise((r) => setTimeout(r, f.durationMs || 1000 / fps));
  }
  rec.stop();
}

async function exportPngSequence(
  frames: { id: string; frameNumber: number; width: number; height: number }[],
  imageMap: Map<string, string>,
  candidate?: { frameNumber: number; thumbnailData?: string; imageData?: string }[],
) {
  if (frames.length === 0) {
    toast.error("沒有影格");
    return;
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const cand = new Map((candidate ?? []).map((f) => [f.frameNumber, f.imageData || f.thumbnailData || ""]));
  let n = 0;
  for (const f of frames) {
    const src = cand.get(f.frameNumber) || imageMap.get(f.id);
    if (!src) continue;
    const img = new Image();
    img.src = jpegUrl(src);
    await new Promise((res) => {
      img.onload = res;
      img.onerror = res;
    });
    canvas.width = img.naturalWidth || f.width;
    canvas.height = img.naturalHeight || f.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) continue;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `frame_${String(f.frameNumber).padStart(4, "0")}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
    n += 1;
    await new Promise((r) => setTimeout(r, 80));
  }
  toast.message(`已匯出 ${n} 張 PNG`);
}

function previewFromRevision(row: { previous_json?: string; new_json?: string }): string | null {
  const pick = (raw?: string) => {
    if (!raw) return null;
    try {
      const o = JSON.parse(raw) as {
        thumbnailData?: string;
        imageData?: string;
        frames?: { thumbnailData?: string; imageData?: string }[];
      };
      return o.thumbnailData || o.imageData || o.frames?.[0]?.thumbnailData || o.frames?.[0]?.imageData || null;
    } catch {
      return null;
    }
  };
  return pick(row.new_json) || pick(row.previous_json);
}
