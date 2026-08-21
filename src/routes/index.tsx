import { createFileRoute, Link } from "@tanstack/react-router";
import { HeroStage } from "@/components/workstation/hero-stage";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { ArrowRight } from "lucide-react";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { user } = useCurrentUserState();

  return (
    <main className="min-h-screen bg-bg">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-[var(--radius-xs)] border border-border bg-surface text-[10px] font-medium tracking-wide text-accent">
            FL
          </span>
          <span className="text-sm font-medium tracking-tight">FrameLab</span>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          {user ? (
            <Link
              to="/studio"
              className="rounded-[var(--radius-sm)] bg-accent px-3 py-2 font-medium text-accent-fg"
            >
              開啟工作室
            </Link>
          ) : (
            <Link
              to="/login"
              className="rounded-[var(--radius-sm)] border border-border px-3 py-2 text-muted hover:text-fg"
            >
              登入
            </Link>
          )}
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl gap-10 px-6 pb-20 pt-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pt-16">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-muted">
            逐幀動畫工作站
          </p>
          <h1 className="mt-4 max-w-xl text-4xl font-medium leading-[1.12] tracking-[-0.03em] text-fg sm:text-5xl">
            給它關鍵影格。只修壞掉的那幾格。
          </h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-muted">
            FrameLab 不是剪輯軟體，也不是生成網站。它是一條有影格圖的時間軸 —
            洋蔥皮、關鍵格、中間格、像素一致性，以及 MCP 協定，讓外部 AI
            用同一套指令工作。
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {user ? (
              <Link
                to="/studio"
                className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-sm)] bg-accent px-4 text-sm font-medium text-accent-fg"
              >
                繼續進入工作室
                <ArrowRight className="size-4" />
              </Link>
            ) : (
              <Link
                to="/login"
                className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-sm)] bg-accent px-4 text-sm font-medium text-accent-fg"
              >
                登入工作室
                <ArrowRight className="size-4" />
              </Link>
            )}
            <a
              href="/api/health"
              className="inline-flex h-11 items-center rounded-[var(--radius-sm)] border border-border px-4 text-sm text-muted hover:text-fg"
            >
              系統狀態
            </a>
          </div>
          <dl className="mt-10 grid grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-faint">中間影格</dt>
              <dd className="mt-1 text-fg">動作計畫 + 線性混合</dd>
            </div>
            <div>
              <dt className="text-faint">一致性</dt>
              <dd className="mt-1 text-fg">真實像素指標</dd>
            </div>
            <div>
              <dt className="text-faint">代理</dt>
              <dd className="mt-1 text-fg">MCP + 權限範圍</dd>
            </div>
          </dl>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-3">
          <HeroStage />
          <p className="mt-3 px-1 text-xs text-faint">
            兩次彈跳的壓扁拉長洋蔥皮。登入後同一鏡頭會成為範例時間軸。
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-24 sm:grid-cols-3">
        {[
          {
            title: "已載入",
            body: "像素 MAE、直方圖閃爍、16×16 區塊比對、動作計畫中間格（線性混合候選）、鄰域修復、你指定影格的 Grok 視覺。",
          },
          {
            title: "保留未載入",
            body: "SAM 2、RTMPose、SEA-RAFT、LocoTrack、Depth Anything、RIFE、Wan。適配器存在，回傳 MODEL_NOT_AVAILABLE，直到註冊檢查點。",
          },
          {
            title: "代理怎麼接",
            body: "在工作室簽發 MCP token。POST /api/mcp 帶 Bearer。與介面同一套指令 — analyze_consistency、generate_inbetweens、repair_frame_range — 有權限範圍與稽核紀錄。",
          },
        ].map((card) => (
          <article
            key={card.title}
            className="rounded-[var(--radius-md)] border border-border bg-surface p-5"
          >
            <h2 className="text-sm font-medium text-fg">{card.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{card.body}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
