import { Lock, LockOpen, Minus, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ProviderInfo } from "@/lib/ai/llm-provider";
import type { SuggestedAction } from "@/lib/domain/conversation";
import type { SerializedContext } from "@/lib/domain/context-engine";
import { cn } from "@/lib/utils";

export type ChatLine = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  contextVersion?: number;
  stale?: boolean;
  suggestions?: SuggestedAction[];
  assist?: {
    summary?: string;
    problem_ranges?: { start: number; end: number; peak_frame: number; severity: string; reason?: string; category?: string }[];
    repair_plan?: { repair_range: [number, number]; protected_frames: number[] } | null;
    context_label?: string;
  };
};

export function ConversationPanel({
  open,
  onClose,
  onMinimize,
  providers,
  providerId,
  onProvider,
  chips,
  following,
  lockLabel,
  onToggleLock,
  messages,
  sending,
  toolStatus,
  stale,
  onSend,
  onSuggestion,
  providerStatus,
  mode = "ASK",
  onMode,
  onViewRange,
  docked = false,
}: {
  open: boolean;
  onClose: () => void;
  onMinimize: () => void;
  providers: ProviderInfo[];
  providerId: string;
  onProvider: (id: string) => void;
  chips: string[];
  following: boolean;
  lockLabel: string;
  onToggleLock: () => void;
  messages: ChatLine[];
  sending: boolean;
  toolStatus: string | null;
  stale: boolean;
  onSend: (text: string) => void;
  onSuggestion: (action: SuggestedAction) => void;
  providerStatus: string;
  mode?: "ASK" | "ASSIST";
  onMode?: (mode: "ASK" | "ASSIST") => void;
  onViewRange?: (start: number, end: number, peak: number) => void;
  docked?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending, toolStatus]);

  if (!open) return null;

  return (
    <aside className={cn(
      "pointer-events-auto flex h-full w-full flex-col border-border bg-surface",
      docked
        ? "relative border-l"
        : "absolute right-3 top-3 z-30 h-[min(72vh,560px)] w-[min(340px,calc(100vw-1.5rem))] rounded-[var(--radius-md)] border shadow-[var(--shadow-panel)]",
    )}>
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <p className="text-xs uppercase tracking-wide text-faint">AI</p>
        <Badge tone="muted">{mode}</Badge>
        {onMode && (
          <button
            type="button"
            className="text-[10px] text-muted hover:text-fg"
            onClick={() => onMode(mode === "ASK" ? "ASSIST" : "ASK")}
          >
            {mode === "ASK" ? "ASSIST" : "ASK"}
          </button>
        )}
        <span className="ml-auto flex gap-1">
          <Button variant="ghost" size="icon" onClick={onMinimize} aria-label="Minimize">
            <Minus className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        <select
          className="h-8 rounded-[var(--radius-sm)] border border-border bg-subtle px-2 text-xs text-fg"
          value={providerId}
          onChange={(e) => onProvider(e.target.value)}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.configured ? "" : " · NOT_CONFIGURED"}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-faint">{providerStatus}</span>
        <button
          type="button"
          onClick={onToggleLock}
          className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted hover:text-fg"
        >
          {following ? <LockOpen className="size-3" /> : <Lock className="size-3" />}
          {following ? "Following workspace" : lockLabel}
        </button>
      </div>

      {providerStatus === "NOT_CONFIGURED" && (
        <p className="border-b border-border px-3 py-1.5 text-[11px] text-warn">AI provider is not configured.</p>
      )}

      <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
        {chips.length === 0 && <span className="text-[11px] text-faint">No selection</span>}
        {chips.map((c) => (
          <span key={c} className="rounded-[var(--radius-xs)] bg-raised px-1.5 py-0.5 font-mono text-[10px] text-muted">
            {c}
          </span>
        ))}
      </div>

      {stale && (
        <p className="border-b border-warn/30 bg-warn/10 px-3 py-1.5 text-[11px] text-warn">This answer refers to an earlier selection.</p>
      )}

      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <p className="text-xs leading-relaxed text-muted">
            {mode === "ASSIST"
              ? "Box a region or stop on a frame, then ask. FrameLab will point at the problem — it will not edit until you confirm."
              : "Point at a frame, drag a range, box a region, then ask. The assistant only reads this workspace."}
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={cn("text-sm", m.role === "user" ? "text-fg" : "text-muted")}>
            <p className="text-[10px] uppercase tracking-wide text-faint">
              {m.role === "user" ? "You" : "Assistant"}
              {m.stale ? " · earlier selection" : ""}
              {m.assist?.context_label ? ` · Based on ${m.assist.context_label}` : ""}
            </p>
            <p className="mt-1 whitespace-pre-wrap leading-relaxed">{visibleText(m.content)}</p>
            {m.assist?.problem_ranges?.length ? (
              <div className="mt-2 space-y-1 rounded-[var(--radius-sm)] border border-border bg-subtle p-2 text-[11px]">
                {m.assist.problem_ranges.slice(0, 4).map((r) => (
                  <div key={`${r.start}-${r.end}`} className="flex items-center justify-between gap-2">
                    <p className="text-muted">
                      F{r.start}–F{r.end}
                      {r.category ? ` · ${r.category.replace(/_/g, " ")}` : ""}
                    </p>
                    <button
                      type="button"
                      className="text-accent"
                      onClick={() => onViewRange?.(r.start, r.end, r.peak_frame)}
                    >
                      View
                    </button>
                  </div>
                ))}
                {m.assist.repair_plan ? (
                  <p className="text-warn">
                    Repair F{m.assist.repair_plan.repair_range[0]}–F{m.assist.repair_plan.repair_range[1]} (confirm)
                  </p>
                ) : null}
              </div>
            ) : null}
            {m.suggestions?.length ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {m.suggestions.map((s, i) => (
                  <Button key={`${s.action}-${i}`} size="sm" variant="secondary" onClick={() => onSuggestion(s)}>
                    {s.label}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {(sending || toolStatus) && <p className="text-[11px] text-faint">{toolStatus || "Looking at neighbors…"}</p>}
      </div>

      <form
        className="flex gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const text = draft.trim();
          if (!text || sending) return;
          onSend(text);
          setDraft("");
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="這裡為什麼怪怪的？"
          rows={2}
          className="min-h-10 flex-1 resize-none rounded-[var(--radius-sm)] border border-border bg-subtle px-2 py-1.5 text-sm text-fg placeholder:text-faint"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              const text = draft.trim();
              if (!text || sending) return;
              onSend(text);
              setDraft("");
            }
          }}
        />
        <Button type="submit" size="icon" disabled={sending || !draft.trim()} aria-label="Send">
          <Send className="size-4" />
        </Button>
      </form>
    </aside>
  );
}

function visibleText(content: string) {
  return content.replace(/\s*\{\s*"type"\s*:\s*"suggestion"[\s\S]*?\}\s*/g, "\n").trim();
}

export function chipsFromSnapshot(snap: SerializedContext | null, characterName?: string | null): string[] {
  if (!snap) return [];
  const chips: string[] = [];
  if (snap.current_frame != null) chips.push(`F${snap.current_frame}`);
  if (snap.selected_range && snap.selected_range[0] !== snap.selected_range[1]) {
    chips.push(`F${snap.selected_range[0]}–F${snap.selected_range[1]}`);
  }
  if (characterName) chips.push(`Character ${characterName}`);
  else if (snap.selected_character) chips.push("Character");
  if (snap.selected_region) chips.push("Region selected");
  if (snap.onion_skin.enabled) {
    chips.push(`Onion ${snap.onion_skin.previousFrames}/${snap.onion_skin.nextFrames}`);
  }
  return chips;
}
