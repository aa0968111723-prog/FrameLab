import { sampleStripIndices } from "@/lib/visual/thumbnail-cache";
import { locateProblemBox } from "@/lib/visual/problem-locate";
import { jpegUrl } from "@/lib/visual/jpeg-url";
import { cn } from "@/lib/utils";

type Frame = { id: string; frameNumber: number; thumbnailData?: string; width?: number; height?: number };
type Joint = { name: string; x: number; y: number; confidence: number };
type Track = { name: string; x: number; y: number; frame_number: number };

function Strip({
  title,
  category,
  frames,
  imageMap,
  consMap,
  poses,
  tracking,
  onSeek,
}: {
  title: string;
  category: string;
  frames: Frame[];
  imageMap: Map<string, string>;
  consMap: Map<number, { severity: string }>;
  poses: { frame_number: number; joints: Joint[] }[];
  tracking: Track[];
  onSeek: (n: number) => void;
}) {
  const idx = sampleStripIndices(frames.length, 6);
  if (idx.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-[10px] uppercase tracking-wide text-faint">{title}</p>
      <div className="mt-1 flex gap-1">
        {idx.map((i) => {
          const f = frames[i];
          if (!f) return null;
          const src = jpegUrl(imageMap.get(f.id) || f.thumbnailData || "");
          const bad = consMap.get(f.frameNumber)?.severity;
          const joints = poses.find((p) => p.frame_number === f.frameNumber)?.joints ?? [];
          const box = locateProblemBox({
            category,
            frameNumber: f.frameNumber,
            frameWidth: f.width ?? 1,
            frameHeight: f.height ?? 1,
            joints,
            tracking,
          });
          const style = box
            ? {
                width: `${100 / Math.max(0.08, box.w)}%`,
                height: `${100 / Math.max(0.08, box.h)}%`,
                marginLeft: `${(-box.x / Math.max(0.08, box.w)) * 100}%`,
                marginTop: `${(-box.y / Math.max(0.08, box.h)) * 100}%`,
                maxWidth: "none",
              }
            : undefined;
          return (
            <button key={f.id} type="button" onClick={() => onSeek(f.frameNumber)} className="w-12">
              <span
                className={cn(
                  "block h-12 w-12 overflow-hidden rounded-[var(--radius-xs)] border",
                  bad && bad !== "ok" ? "border-warn" : "border-border",
                )}
              >
                {src ? (
                  <img src={src} alt="" className="h-full w-full object-cover" style={style} />
                ) : null}
              </span>
              <span className="font-mono text-[9px] text-faint">
                F{f.frameNumber}
                {bad && bad !== "ok" ? " !" : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ConsistencyStrips({
  frames,
  imageMap,
  consMap,
  poses,
  tracking,
  onSeek,
}: {
  frames: Frame[];
  imageMap: Map<string, string>;
  consMap: Map<number, { severity: string }>;
  poses?: { frame_number: number; joints_json?: string; joints?: Joint[] }[];
  tracking?: Track[];
  onSeek: (n: number) => void;
}) {
  const parsed = (poses ?? []).map((p) => {
    if (p.joints) return { frame_number: p.frame_number, joints: p.joints };
    try {
      return { frame_number: p.frame_number, joints: JSON.parse(p.joints_json || "[]") as Joint[] };
    } catch {
      return { frame_number: p.frame_number, joints: [] as Joint[] };
    }
  });
  const tracks = tracking ?? [];
  return (
    <div>
      <Strip title="臉" category="FACE" frames={frames} imageMap={imageMap} consMap={consMap} poses={parsed} tracking={tracks} onSeek={onSeek} />
      <Strip title="手" category="HAND" frames={frames} imageMap={imageMap} consMap={consMap} poses={parsed} tracking={tracks} onSeek={onSeek} />
      <Strip title="物件" category="OBJECT" frames={frames} imageMap={imageMap} consMap={consMap} poses={parsed} tracking={tracks} onSeek={onSeek} />
    </div>
  );
}
