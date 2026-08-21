import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Film,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserButton } from "@/lib/auth/gates";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  createMcpTokenFn,
  createProjectFn,
  createSample,
  deleteProjectFn,
  getModelsFn,
  ingestSequenceFn,
  listMcpTokensFn,
  listMyProjects,
  getJobFn,
} from "@/lib/framelab/api";
import {
  extractImageSequenceBatches,
  INGEST_HTTP_BATCH,
} from "@/lib/extract-frames";

export function ProjectHome() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) {
    return <div className="min-h-screen bg-bg" />;
  }
  if (!user) return <RedirectToSignIn />;
  return <HomeInner />;
}

function HomeInner() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const ffmpegRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [tokenPlain, setTokenPlain] = useState<string | null>(null);

  const [bootstrapped, setBootstrapped] = useState(false);

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => listMyProjects(),
  });
  const models = useQuery({
    queryKey: ["models"],
    queryFn: () => getModelsFn(),
  });
  const tokens = useQuery({
    queryKey: ["mcp-tokens"],
    queryFn: () => listMcpTokensFn(),
  });

  const sample = useMutation({
    mutationFn: () => createSample({ data: { name: "經典彈跳球" } }),
    onSuccess: (r) => {
      const id = r.projectId ?? r.id;
      toast.success("範例時間軸已就緒");
      if (!id) {
        void qc.invalidateQueries({ queryKey: ["projects"] });
        return;
      }
      void nav({ to: "/studio/$projectId", params: { projectId: id } });
    },
    onError: (e) => toast.error(e.message || "無法建立範例"),
  });

  useEffect(() => {
    if (bootstrapped || sample.isPending || sample.isSuccess) return;
    if (!projects.isSuccess) return;
    const list = projects.data ?? [];
    if (list.length === 1) {
      setBootstrapped(true);
      void nav({ to: "/studio/$projectId", params: { projectId: list[0].id } });
      return;
    }
    if (list.length > 0) return;
    setBootstrapped(true);
    sample.mutate();
  }, [bootstrapped, projects.isSuccess, projects.data, sample, nav]);

  const create = useMutation({
    mutationFn: () =>
      createProjectFn({ data: { name: name.trim() || "未命名", fps: 24 } }),
    onSuccess: (r) => {
      toast.success("專案已建立");
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

  const mint = useMutation({
    mutationFn: () =>
      createMcpTokenFn({
        data: {
          name: "工作室代理",
          scopes: "READ,ANALYZE,EDIT,GENERATE,RENDER",
        },
      }),
    onSuccess: (r) => {
      setTokenPlain(r.token);
      void qc.invalidateQueries({ queryKey: ["mcp-tokens"] });
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
      setBusy(`拆幀中${extra} ${job.progress ?? 0}%`);
      if (job.state === "completed") return job;
      if (job.state === "failed" || job.state === "cancelled") {
        throw new Error(job.error_message || "拆幀失敗");
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  async function onFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = [...list];
    const video = files.find((f) => f.type.startsWith("video/"));
    if (video) {
      const only = { 0: video, length: 1, item: (i: number) => (i === 0 ? video : null) } as unknown as FileList;
      await onFfmpeg(only);
      return;
    }
    setBusy("讀取影像序列…");
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
              name: "影像序列",
              fps: 12,
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
        toast.error("沒有擷取到影格");
        return;
      }
      toast.success(`${frameCount} 格`);
      void nav({
        to: "/studio/$projectId",
        params: { projectId },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "匯入失敗");
    } finally {
      setBusy(null);
    }
  }

  async function onFfmpeg(list: FileList | null) {
    if (!list || list.length === 0) return;
    const file = list[0];
    setBusy("上傳影片…");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("fps", "12");
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
        toast.error(json.error || "影片擷取失敗");
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
      toast.success(`${frameCount || "?"} 格`);
      void nav({ to: "/studio/$projectId", params: { projectId: json.projectId } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "影片匯入失敗");
    } finally {
      setBusy(null);
    }
  }

  const ready = models.data?.models.filter((m) => m.status === "ready") ?? [];
  const missing =
    models.data?.models.filter((m) => m.status !== "ready") ?? [];

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

      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-8 lg:grid-cols-[1fr_320px]">
        <section>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-medium tracking-tight">專案</h1>
              <p className="mt-1 text-sm text-muted">
                開啟時間軸，或從經典彈跳球開始。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => sample.mutate()}
                disabled={sample.isPending}
              >
                {sample.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                經典彈跳球
              </Button>
              <Button
                variant="secondary"
                onClick={() => fileRef.current?.click()}
                disabled={Boolean(busy)}
              >
                <Upload className="size-4" />
                匯入
              </Button>
              <Button
                variant="ghost"
                onClick={() => ffmpegRef.current?.click()}
                disabled={Boolean(busy)}
              >
                <Film className="size-4" />
                FFmpeg 匯入
              </Button>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept="video/*,image/*"
                multiple
                onChange={(e) => void onFiles(e.target.files)}
              />
              <input
                ref={ffmpegRef}
                type="file"
                className="hidden"
                accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.mkv"
                onChange={(e) => void onFfmpeg(e.target.files)}
              />
            </div>
          </div>

          {busy && (
            <p className="mt-4 text-sm text-muted">
              <Loader2 className="mr-2 inline size-4 animate-spin" />
              {busy}
            </p>
          )}
          {sample.isPending && !busy && (
            <p className="mt-4 text-sm text-muted">
              <Loader2 className="mr-2 inline size-4 animate-spin" />
              正在開啟經典彈跳球…
            </p>
          )}

          <form
            className="mt-6 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="新建空白專案"
            />
            <Button type="submit" disabled={create.isPending}>
              <Plus className="size-4" />
              建立
            </Button>
          </form>

          <ul className="mt-6 divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
            {(projects.data ?? []).length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-muted">
                還沒有專案。從彈跳球開始 — 洋蔥皮才是重點。
              </li>
            )}
            {(projects.data ?? []).map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <Link
                  to="/studio/$projectId"
                  params={{ projectId: p.id }}
                  className="min-w-0 flex-1"
                >
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="text-xs text-faint">
                    {p.fps} fps · {p.width}×{p.height}
                  </p>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="刪除專案"
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

        <aside className="space-y-6">
          <div className="rounded-[var(--radius-md)] border border-border bg-surface p-4">
            <h2 className="text-sm font-medium">可用供應商</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {ready.map((m) => (
                <li key={m.id} className="flex justify-between gap-2">
                  <span>{m.modelName}</span>
                  <span className="text-good">就緒</span>
                </li>
              ))}
            </ul>
            <h3 className="mt-4 text-xs uppercase tracking-wide text-faint">
              未載入
            </h3>
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {missing.map((m) => (
                <li key={m.id}>
                  {m.modelName} — {modelStatusZh(m.status)}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-[var(--radius-md)] border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">MCP 權杖</h2>
              <Button size="sm" variant="secondary" onClick={() => mint.mutate()}>
                簽發
              </Button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              POST /api/mcp 帶 Bearer 權杖。權杖會雜湊儲存；密鑰只顯示一次。
            </p>
            {tokenPlain && (
              <pre className="mt-3 overflow-x-auto rounded-[var(--radius-sm)] bg-bg p-2 text-[11px] text-key">
                {tokenPlain}
              </pre>
            )}
            <ul className="mt-3 space-y-1 text-xs text-muted">
              {(tokens.data ?? []).map((t) => (
                <li key={t.id}>
                  {t.name} · {t.tokenPrefix}… · {t.scopes}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-[var(--radius-md)] border border-border bg-surface p-4 text-xs leading-relaxed text-muted">
            <Film className="mb-2 size-4 text-fg" />
            影片匯入走非同步拆幀，可處理數千格；不會一次把全部畫面塞進單一請求。空白專案會等你匯入 — 不會用假畫面充數。
          </div>
        </aside>
      </div>
    </div>
  );
}

function modelStatusZh(status: string) {
  if (status === "unavailable" || status === "MODEL_NOT_AVAILABLE") return "尚未提供";
  if (status === "ready") return "就緒";
  if (status === "not_configured") return "尚未設定";
  return status;
}
