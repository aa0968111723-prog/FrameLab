import { createFileRoute, Link } from "@tanstack/react-router";
import { HeroStage } from "@/components/workstation/hero-stage";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { ArrowRight } from "lucide-react";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { user } = useCurrentUserState();

  return (
    <main className="min-h-screen bg-bg">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
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
              進入工作室
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

      <section className="mx-auto grid max-w-5xl gap-10 px-6 pb-20 pt-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pt-16">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-muted">逐幀動畫工作站</p>
          <h1 className="mt-4 max-w-xl text-4xl font-medium leading-[1.12] tracking-[-0.03em] text-fg sm:text-5xl">
            建立動畫。一格一格修。
          </h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-muted">
            從空白時間軸開始，或匯入影片與圖片序列。最近專案會留在這裡，隨時打開繼續畫。
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {user ? (
              <Link
                to="/studio"
                className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-sm)] bg-accent px-4 text-sm font-medium text-accent-fg"
              >
                開始
                <ArrowRight className="size-4" />
              </Link>
            ) : (
              <Link
                to="/login"
                className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-sm)] bg-accent px-4 text-sm font-medium text-accent-fg"
              >
                登入後開始
                <ArrowRight className="size-4" />
              </Link>
            )}
          </div>
          <ul className="mt-10 grid gap-2 text-sm text-muted sm:grid-cols-2">
            <li>建立動畫</li>
            <li>匯入影片</li>
            <li>匯入圖片序列</li>
            <li>最近專案</li>
            <li>開啟範例</li>
          </ul>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-3">
          <HeroStage />
          <p className="mt-3 px-1 text-xs text-faint">範例彈跳球。登入後可從首頁開啟同一條時間軸。</p>
        </div>
      </section>
    </main>
  );
}
