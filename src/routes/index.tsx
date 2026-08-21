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
              Open studio
            </Link>
          ) : (
            <Link
              to="/login"
              className="rounded-[var(--radius-sm)] border border-border px-3 py-2 text-muted hover:text-fg"
            >
              Sign in
            </Link>
          )}
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl gap-10 px-6 pb-20 pt-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pt-16">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-muted">
            Frame-by-frame workstation
          </p>
          <h1 className="mt-4 max-w-xl text-4xl font-medium leading-[1.12] tracking-[-0.03em] text-fg sm:text-5xl">
            Give it keyframes. Repair only the frames that break.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-muted">
            FrameLab is not a NLE, not a generator site. It is a timeline of
            frames with a graph behind them — onion skin, keys, inbetweens,
            pixel consistency, and an MCP protocol so an agent can work the
            same commands you do.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {user ? (
              <Link
                to="/studio"
                className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-sm)] bg-accent px-4 text-sm font-medium text-accent-fg"
              >
                Continue in studio
                <ArrowRight className="size-4" />
              </Link>
            ) : (
              <Link
                to="/login"
                className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-sm)] bg-accent px-4 text-sm font-medium text-accent-fg"
              >
                Sign in to the studio
                <ArrowRight className="size-4" />
              </Link>
            )}
            <a
              href="/api/health"
              className="inline-flex h-11 items-center rounded-[var(--radius-sm)] border border-border px-4 text-sm text-muted hover:text-fg"
            >
              System status
            </a>
          </div>
          <dl className="mt-10 grid grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-faint">Inbetween</dt>
              <dd className="mt-1 text-fg">Motion plan + linear-blend</dd>
            </div>
            <div>
              <dt className="text-faint">Consistency</dt>
              <dd className="mt-1 text-fg">Pixel metrics, real</dd>
            </div>
            <div>
              <dt className="text-faint">Agents</dt>
              <dd className="mt-1 text-fg">MCP + scopes</dd>
            </div>
          </dl>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-3">
          <HeroStage />
          <p className="mt-3 px-1 text-xs text-faint">
            Onion skin of a 2-bounce squash-and-stretch. Same shot ships as a
            sample timeline after you sign in.
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-24 sm:grid-cols-3">
        {[
          {
            title: "What is loaded",
            body: "Pixel MAE, histogram flicker, 16×16 block matching, motion-plan inbetweens (linear-blend candidate), neighborhood repair, Grok vision on frames you pick.",
          },
          {
            title: "What is reserved",
            body: "SAM 2, RTMPose, SEA-RAFT, LocoTrack, Depth Anything, RIFE, Wan. Adapters exist. They return MODEL_NOT_AVAILABLE until a checkpoint is registered.",
          },
          {
            title: "How agents work",
            body: "Issue an MCP token in the studio. POST /api/mcp with Bearer. Same commands as the UI — analyze_consistency, generate_inbetweens, repair_frame_range — with scopes and an audit log.",
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
