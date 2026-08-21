import { createFileRoute, Link } from "@tanstack/react-router";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <main className="grid min-h-screen place-items-center bg-bg px-6">
      <div className="w-full max-w-sm rounded-[var(--radius-lg)] border border-border bg-surface p-6 shadow-[var(--shadow-panel)]">
        <Link to="/" className="text-xs uppercase tracking-[0.18em] text-muted">
          FrameLab
        </Link>
        <h1 className="mt-4 font-sans text-2xl font-medium tracking-tight text-fg">
          登入
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          專案、影格與 MCP token 都綁在你的帳號上。
        </p>
        <div className="mt-6 space-y-2">
          {authEnabled ? (
            GROK_PROVIDERS.map((p) => (
              <Button
                key={p.providerId}
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => void signIn(p.providerId, { callbackURL: "/studio" })}
              >
                使用 {p.label} 繼續
              </Button>
            ))
          ) : (
            <p className="text-sm text-muted">登入已停用。</p>
          )}
        </div>
      </div>
    </main>
  );
}
