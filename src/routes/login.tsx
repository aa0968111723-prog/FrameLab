import { useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { GROK_PROVIDERS, authClient, authEnabled, signIn } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"in" | "up" | "oauth" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function afterSession() {
    await authClient.getSession();
    await nav({ to: "/studio" });
  }

  async function onSignIn(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("in");
    try {
      const { error: err } = await authClient.signIn.email({
        email: email.trim(),
        password,
      });
      if (err) {
        setError(err.message || "登入失敗");
        return;
      }
      await afterSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登入失敗");
    } finally {
      setBusy(null);
    }
  }

  async function onSignUp() {
    setError(null);
    if (password.length < 8) {
      setError("密碼至少 8 個字元");
      return;
    }
    setBusy("up");
    try {
      const name = email.trim().split("@")[0] || "FrameLab";
      const { error: err } = await authClient.signUp.email({
        email: email.trim(),
        password,
        name,
      });
      if (err) {
        setError(err.message || "無法建立帳號");
        return;
      }
      await afterSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法建立帳號");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-bg px-6">
      <div className="w-full max-w-sm rounded-[var(--radius-lg)] border border-border bg-surface p-6 shadow-[var(--shadow-panel)]">
        <Link to="/" className="text-xs uppercase tracking-[0.18em] text-muted">
          FrameLab
        </Link>
        <h1 className="mt-4 font-sans text-2xl font-medium tracking-tight text-fg">
          進入工作室
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          用電子郵件建立帳號就能立刻操作時間軸。Google / X 也可。
        </p>
        {authEnabled ? (
          <>
            <form className="mt-6 space-y-3" onSubmit={(e) => void onSignIn(e)}>
              <label className="block text-[11px] uppercase tracking-wide text-faint">
                電子郵件
                <Input
                  className="mt-1"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@mail.com"
                />
              </label>
              <label className="block text-[11px] uppercase tracking-wide text-faint">
                密碼
                <Input
                  className="mt-1"
                  type="password"
                  autoComplete="current-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="至少 8 個字元"
                />
              </label>
              {error && <p className="text-sm text-danger">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy !== null}>
                {busy === "in" ? "登入中…" : "登入並進入工作室"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                disabled={busy !== null}
                onClick={() => void onSignUp()}
              >
                {busy === "up" ? "建立中…" : "建立新帳號"}
              </Button>
            </form>
            <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wide text-faint">
              <span className="h-px flex-1 bg-border" />
              或
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="space-y-2">
              {GROK_PROVIDERS.map((p) => (
                <Button
                  key={p.providerId}
                  type="button"
                  variant="ghost"
                  className="w-full"
                  disabled={busy !== null}
                  onClick={() => {
                    setBusy("oauth");
                    void signIn(p.providerId, { callbackURL: "/studio" }).catch((err) => {
                      const msg = err instanceof Error ? err.message : "登入被擋住";
                      setError(msg);
                      toast.error(msg);
                      setBusy(null);
                    });
                  }}
                >
                  使用 {p.label} 繼續
                </Button>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-6 text-sm text-muted">登入已停用。</p>
        )}
      </div>
    </main>
  );
}
