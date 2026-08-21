import { sampleStripIndices } from "@/lib/visual/thumbnail-cache";
import { cn } from "@/lib/utils";

function jpegUrl(b64?: string) {
  if (!b64) return "";
  return b64.startsWith("data:") ? b64 : `data:image/jpeg;base64,${b64}`;
}

type Frame = { id: string; frameNumber: number; thumbnailData?: string };

function Strip({
  title,
  frames,
  imageMap,
  consMap,
  onSeek,
  objectTop,
}: {
  title: string;
  frames: Frame[];
  imageMap: Map<string, string>;
  consMap: Map<number, { severity: string }>;
  onSeek: (n: number) => void;
  objectTop?: boolean;
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
          return (
            <button key={f.id} type="button" onClick={() => onSeek(f.frameNumber)} className="w-12">
              <span
                className={cn(
                  "block h-12 w-12 overflow-hidden rounded-[var(--radius-xs)] border",
                  bad && bad !== "ok" ? "border-warn" : "border-border",
                )}
              >
                {src ? (
                  <img
                    src={src}
                    alt=""
                    className={cn("h-full w-full object-cover", objectTop !== false && "object-top")}
                  />
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
  onSeek,
}: {
  frames: Frame[];
  imageMap: Map<string, string>;
  consMap: Map<number, { severity: string }>;
  onSeek: (n: number) => void;
}) {
  return (
    <div>
      <Strip title="臉" frames={frames} imageMap={imageMap} consMap={consMap} onSeek={onSeek} />
      <Strip title="手" frames={frames} imageMap={imageMap} consMap={consMap} onSeek={onSeek} />
      <Strip title="物件" frames={frames} imageMap={imageMap} consMap={consMap} onSeek={onSeek} objectTop={false} />
    </div>
  );
}
