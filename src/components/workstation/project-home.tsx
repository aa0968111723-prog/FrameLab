import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Film, FolderOpen, ImageIcon, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RedirectToSignIn, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  createProjectFn,
  createSample,
  deleteProjectFn,
  getJobFn,
  ingestSequenceFn,
  listMyProjects,
} from "@/lib/framelab/api";
import { extractImageSequenceBatches, INGEST_HTTP_BATCH } from "@/lib/extract-frames";
import { DEFAULT_PLAYBACK_FPS, clampFps } from "@/lib/domain/fps";

export function ProjectHome() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return <div className="min-h-screen bg-bg" />;
  if (!user) return <RedirectToSignIn />;
  return <HomeInner />;
}

function HomeInner() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const videoRef = useRef<HTMLInputElement>(null);
  const sequenceRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => listMyProjects(),
  });

  const sample = useMutation({
    mutationFn: () => createSample({ data: { name: "經典彈跳球" } }),
    onSuccess: (r) => {
      const id = r.projectId ?? r.id;
      toast.success("範例已開啟");
      if (!id) {
        void qc.invalidateQueries({ queryKey: ["projects"] });
        return;
      }
      void nav({ to: "/studio/$projectId", params: { projectId: id } });
    },
    onError: (e) => toast.error(e.message || "無法開啟範例"),
  });

  const create = useMutation({
    mutationFn: () =>
      createProjectFn({ data: { name: name.trim() || "未命名動畫", fps: DEFAULT_PLAYBACK_FPS } }),
    onSuccess: (r) => {
      toast.success("動畫已建立");
      const id = r.projectId ?? r.id;
      if (id) void nav({ to: "/studio/$projectId", params: { projectId: id } });
    },
  });

  const remove = useMutation({
    mutationFn: (projectId: string) => deleteProjectFn({ data: { projectId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  async function waitForJob(jobId: string) {
    for (;;) {
      const job = await getJobFn({ data: { jobId } });
      if (!job) throw new Error("找不到拆幀工作");
      let extra = "";
      try {
        const parsed = JSON.parse(job.result_json || "{}") as {
          current?: number;
          total?: number;
          stage?: { current?: number; total?: number };
          frameCount?: number;
        };
        const cur = parsed.stage?.current ?? parsed.current;
        const tot = parsed.stage?.total ?? parsed.total;
        if (cur != null && tot != null) extra = ` ${cur}/${tot}`;
        else if (parsed.frameCount != null) extra = ` ${parsed.frameCount} 格`;
      } catch {
        extra = "";
      }
      setBusy(`匯入中${extra} ${job.progress ?? 0}%`);
      if (job.state === "completed") return job;
      if (job.state === "failed" || job.state === "cancelled") {
        throw new Error(job.error_message || "匯入失敗");
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  function extractField(): string {
    return "auto";
  }

  function playbackField(): string {
    return "same";
  }

  function sequenceFps(): number {
    return clampFps(DEFAULT_PLAYBACK_FPS);
  }

  async function onSequence(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = [...list];
    const video = files.find((f) => f.type.startsWith("video/"));
    if (video) {
      await onVideo({ 0: video, length: 1, item: (i: number) => (i === 0 ? video : null) } as unknown as FileList);
      return;
    }
    setBusy("讀取圖片序列…");
    try {
      let projectId: string | undefined;
      let frameCount = 0;
      await extractImageSequenceBatches(
        files,
        {
          onProgress: (d, t) => setBusy(`讀取 ${d}/${t}`),
          batchSize: INGEST_HTTP_BATCH,
        },
        async (batch) => {
          setBusy(`儲存 ${batch[0]?.frameNumber ?? 0}–${batch.at(-1)?.frameNumber ?? 0}…`);
          const result = await ingestSequenceFn({
            data: {
              name: "圖片序列",
              fps: sequenceFps(),
              projectId,
              replace: !projectId,
              frames: batch.map((f) => ({
                imageData: f.imageData,
                frameNumber: f.frameNumber,
              })),
            },
          });
          if (!result.ok) throw new Error(result.error);
          projectId = result.projectId;
          frameCount = result.frameCount;
        },
      );
      if (!projectId || frameCount === 0) {
        toast.error("沒有讀到影格");
        return;
      }
      toast.success(`已匯入 ${frameCount} 格`);
      void nav({ to: "/studio/$projectId", params: { projectId } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "匯入失敗");
    } finally {
      setBusy(null);
    }
  }

  async function onVideo(list: FileList | null) {
    if (!list || list.length === 0) return;
    const file = list[0];
    setBusy("上傳影片…");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("fps", extractField());
      body.set("playbackFps", playbackField());
      body.set("name", file.name);
      const res = await fetch("/api/videos", { method: "POST", body });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        projectId?: string;
        frameCount?: number;
        jobId?: string;
      };
      if (!json.ok || !json.projectId) {
        toast.error(json.error || "影片匯入失敗");
        return;
      }
      let frameCount = json.frameCount ?? 0;
      if (json.jobId) {
        const job = await waitForJob(json.jobId);
        try {
          const parsed = JSON.parse(job.result_json || "{}") as { frameCount?: number };
          if (parsed.frameCount) frameCount = parsed.frameCount;
        } catch {
          /* keep previous */
        }
      }
      toast.success(`已匯入 ${frameCount || "?"} 格`);
      void nav({ to: "/studio/$projectId", params: { projectId: json.projectId } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "影片匯入失敗");
    } finally {
      setBusy(null);
    }
  }

  const list = projects.data ?? [];

  return (
    <div className="min-h-screen bg-bg">
      <header className="flex items-center justify-between border-b border-border px-5 py-3">
        <Link to="/" className="flex items-center gap-2 text-sm font-medium">
          <span className="grid h-7 w-7 place-items-center rounded-[var(--radius-xs)] border border-border text-[10px] text-accent">
            FL
          </span>
          FrameLab
        </Link>
        <UserButton />
      </header>

      <div className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="text-2xl font-medium tracking-tight">開始</h1>
        <p className="mt-1 text-sm text-muted">建立動畫，或從既有畫面繼續。</p>

        <form
          className="mt-8 rounded-[var(--radius-md)] border border-border bg-surface p-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <p className="text-sm font-medium">建立動畫</p>
          <div className="mt-3 flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="動畫名稱"
              aria-label="動畫名稱"
            />
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              建立
            </Button>
          </div>
        </form>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => videoRef.current?.click()}
            className="rounded-[var(--radius-md)] border border-border bg-surface p-4 text-left hover:bg-raised"
          >
            <Film className="size-4 text-fg" />
            <p className="mt-3 text-sm font-medium">匯入影片</p>
            <p className="mt-1 text-xs text-muted">從影片拆成影格</p>
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => sequenceRef.current?.click()}
            className="rounded-[var(--radius-md)] border border-border bg-surface p-4 text-left hover:bg-raised"
          >
            <ImageIcon className="size-4 text-fg" />
            <p className="mt-3 text-sm font-medium">匯入圖片序列</p>
            <p className="mt-1 text-xs text-muted">JPG / PNG 連續畫面</p>
          </button>
          <button
            type="button"
            disabled={sample.isPending}
            onClick={() => sample.mutate()}
            className="rounded-[var(--radius-md)] border border-border bg-surface p-4 text-left hover:bg-raised"
          >
            {sample.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4 text-fg" />}
            <p className="mt-3 text-sm font-medium">開啟範例</p>
            <p className="mt-1 text-xs text-muted">經典彈跳球時間軸</p>
          </button>
        </div>

        <input
          ref={videoRef}
          type="file"
          className="hidden"
          accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.mkv"
          onChange={(e) => void onVideo(e.target.files)}
        />
        <input
          ref={sequenceRef}
          type="file"
          className="hidden"
          accept="image/*"
          multiple
          onChange={(e) => void onSequence(e.target.files)}
        />

        {busy && (
          <p className="mt-4 text-sm text-muted">
            <Loader2 className="mr-2 inline size-4 animate-spin" />
            {busy}
          </p>
        )}

        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <FolderOpen className="size-4" />
            最近專案
          </h2>
          <ul className="mt-3 divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
            {projects.isLoading && (
              <li className="px-4 py-10 text-center text-sm text-muted">讀取專案…</li>
            )}
            {!projects.isLoading && list.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-muted">還沒有專案。建立動畫，或開啟範例。</li>
            )}
            {list.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <Link to="/studio/$projectId" params={{ projectId: p.id }} className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="text-xs text-faint">
                    {p.fps} fps · {p.width}×{p.height}
                  </p>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`刪除 ${p.name}`}
                  onClick={() => {
                    if (confirm(`刪除 ${p.name}？`)) remove.mutate(p.id);
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
