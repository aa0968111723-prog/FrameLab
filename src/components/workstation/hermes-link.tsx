import { Cable, Check, Copy, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createMcpTokenFn } from "@/lib/framelab/api";

const HERMES_SCOPES = "READ,ANALYZE,SUGGEST,EDIT,GENERATE,RENDER";

export function HermesLinkCard() {
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const origin =
    typeof window !== "undefined" ? window.location.origin.replace(/\/$/, "") : "";
  const endpoint = `${origin}/api/mcp`;
  const snippet = token
    ? `FRAMELAB_MCP_URL=${endpoint}\nFRAMELAB_MCP_TOKEN=${token}`
    : `FRAMELAB_MCP_URL=${endpoint}\nFRAMELAB_MCP_TOKEN=`;

  async function mint() {
    setBusy(true);
    try {
      const issued = await createMcpTokenFn({
        data: {
          name: "Hermes Console",
          scopes: HERMES_SCOPES,
          projectScope: "all",
        },
      });
      setToken(issued.token);
      setCopied(false);
      toast.success("已產生連線權杖，請立刻複製");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "無法產生連線權杖");
    } finally {
      setBusy(false);
    }
  }

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      toast.success("已複製到剪貼簿");
    } catch {
      toast.error("無法複製，請手動選取");
    }
  }

  return (
    <section className="mt-6 rounded-[var(--radius-md)] border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-xs)] border border-border text-accent">
          <Cable className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">連接 Hermes Console</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            產生權杖後，貼到 Hermes「設定 → 連線」的 FrameLab 欄位。Hermes 會以
            mcp.framelab 名稱呼叫動畫工具。
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={() => void mint()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Cable className="size-4" />}
          {token ? "重新產生" : "產生連線權杖"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!token}
          onClick={() => void copySnippet()}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          複製環境變數
        </Button>
      </div>

      <pre className="mt-3 overflow-x-auto rounded-[var(--radius-sm)] border border-border bg-subtle px-3 py-2 font-mono text-[11px] leading-relaxed text-muted">
        {snippet}
      </pre>
      {token ? (
        <p className="mt-2 text-xs text-warn">權杖只顯示一次。請立刻貼進 Hermes，不要公開分享。</p>
      ) : (
        <p className="mt-2 text-xs text-faint">
          正式環境請用 HTTPS 端點。本機探測需在 Hermes 開啟迴路允許。
        </p>
      )}
    </section>
  );
}
