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
} from "@/lib/framelab/api";
import {
  extractImageSequence,
  extractVideoFrames,
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

  async function onFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = [...list];
    setBusy("讀取媒體…");
    try {
      const video = files.find((f) => f.type.startsWith("video/"));
      const frames = video
        ? await extractVideoFrames(video, {
            fps: 12,
            maxFrames: 72,
            onProgress: (d, t) => setBusy(`擷取 ${d}/${t}`),
          })
        : await extractImageSequence(files, {
            onProgress: (d, t) => setBusy(`讀取 ${d}/${t}`),
          });
      if (frames.length === 0) {
        toast.error("沒有擷取到影格");
        return;
      }
      setBusy("儲存時間軸…");
      const result = await ingestSequenceFn({
        data: {
          name: video?.name ?? "Image sequence",
          fps: video ? 12 : 12,
          frames: frames.map((f) => ({
            imageData: f.imageData,
            frameNumber: f.frameNumber,
          })),
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.frameCount} 格`);
      void nav({
        to: "/studio/$projectId",
        params: { projectId: result.projectId },
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
    setBusy("上傳給 FFmpeg…");
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
        toast.error(json.error || "FFmpeg 擷取失敗");
        return;
      }
      toast.success(`${json.frameCount ?? "?"} 格（FFmpeg）`);
      void nav({ to: "/studio/$projectId", params: { projectId: json.projectId } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "FFmpeg failed");
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
                FFmpeg
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
                  {m.modelName} — {m.status}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-[var(--radius-md)] border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">MCP token</h2>
              <Button size="sm" variant="secondary" onClick={() => mint.mutate()}>
                簽發
              </Button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              POST /api/mcp 帶 Bearer token。token 會雜湊儲存；密鑰只顯示一次。
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
            Video import uses the browser decoder (first 72 frames at 12 fps).
            Empty projects wait for an import — there is no fake footage.
          </div>
        </aside>
      </div>
    </div>
  );
}
