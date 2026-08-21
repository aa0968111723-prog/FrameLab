import { cn } from "@/lib/utils";

export function Badge({
  className,
  tone = "muted",
  ...props
}: React.ComponentProps<"span"> & {
  tone?: "muted" | "key" | "gen" | "warn" | "danger" | "good" | "repair";
}) {
  const tones: Record<string, string> = {
    muted: "bg-raised text-muted",
    key: "bg-key/15 text-key",
    gen: "bg-gen/15 text-gen",
    warn: "bg-warn/15 text-warn",
    danger: "bg-danger/15 text-danger",
    good: "bg-good/15 text-good",
    repair: "bg-repair/15 text-repair",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
