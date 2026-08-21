import { Button } from "@/components/ui/button";
import { categoryLabel } from "@/lib/domain/visual-annotation";
import { matchesProblemFilter, PROBLEM_FILTERS, type ProblemFilter } from "@/lib/visual/workspace-mode";
import { cn } from "@/lib/utils";

export type ProblemItem = {
  i: number;
  peak: number;
  range: [number, number];
  severity: string;
  reason: string;
  category?: string;
};

export function ProblemNavigator({
  items,
  filter,
  onFilter,
  onSelect,
  onScan,
  busy,
}: {
  items: ProblemItem[];
  filter: ProblemFilter;
  onFilter: (f: ProblemFilter) => void;
  onSelect: (p: ProblemItem) => void;
  onScan: () => void;
  busy?: boolean;
}) {
  const shown = items.filter((p) => matchesProblemFilter(p.category, filter));
  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-wide text-faint">Problems</p>
      <div className="flex flex-wrap gap-1">
        {PROBLEM_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => onFilter(f)}
            className={cn(
              "rounded-[var(--radius-xs)] px-1.5 py-0.5 text-[10px]",
              filter === f ? "bg-raised text-fg" : "text-faint hover:text-fg",
            )}
          >
            {f}
          </button>
        ))}
      </div>
      {shown.length === 0 && (
        <p className="text-[11px] text-faint">Nothing marked. Scan the range — FrameLab will not invent issues.</p>
      )}
      {shown.map((p) => (
        <button
          key={p.i}
          type="button"
          className="block w-full rounded-[var(--radius-sm)] border border-border p-2 text-left hover:bg-raised"
          onClick={() => onSelect(p)}
        >
          <p className="text-xs text-fg">
            F{p.range[0]}–F{p.range[1]} · {categoryLabel(p.category)}
          </p>
          <p className="text-[11px] text-faint">{p.reason}</p>
          <span className="mt-1 inline-flex gap-2 text-[10px] text-accent">View · Compare · Repair</span>
        </button>
      ))}
      <Button size="sm" variant="secondary" disabled={busy} onClick={onScan}>
        Scan range
      </Button>
    </div>
  );
}
