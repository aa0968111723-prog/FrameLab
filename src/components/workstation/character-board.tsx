/** Selected character's assigned frames — visual reference, not a JSON list. */

function jpegUrl(b64?: string) {
  if (!b64) return "";
  return b64.startsWith("data:") ? b64 : `data:image/jpeg;base64,${b64}`;
}

export function CharacterBoard({
  characters,
  selectedId,
  assignments,
  frames,
  imageMap,
  onSelect,
  onSeek,
}: {
  characters: { id: string; name: string }[];
  selectedId: string | null;
  assignments: { character_id: string; frame_number: number }[];
  frames: { id: string; frameNumber: number; thumbnailData?: string }[];
  imageMap: Map<string, string>;
  onSelect: (id: string | null) => void;
  onSeek: (n: number) => void;
}) {
  if (characters.length === 0) {
    return <p className="text-[11px] text-faint">尚未建立角色。在進階面板新增後再指定到影格。</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-wide text-faint">角色參考板</p>
      <div className="flex flex-wrap gap-1">
        {characters.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(selectedId === c.id ? null : c.id)}
            className={
              selectedId === c.id
                ? "rounded-[var(--radius-xs)] bg-raised px-1.5 py-0.5 text-[11px] text-fg"
                : "rounded-[var(--radius-xs)] px-1.5 py-0.5 text-[11px] text-faint hover:text-fg"
            }
          >
            {c.name}
          </button>
        ))}
      </div>
      {selectedId ? (
        <div className="flex gap-1 overflow-x-auto">
          {assignments
            .filter((a) => a.character_id === selectedId)
            .map((a) => {
              const f = frames.find((x) => x.frameNumber === a.frame_number);
              const src = f ? jpegUrl(imageMap.get(f.id) || f.thumbnailData || "") : "";
              return (
                <button
                  key={`${a.character_id}-${a.frame_number}`}
                  type="button"
                  onClick={() => onSeek(a.frame_number)}
                  className="w-10 shrink-0"
                >
                  <span className="block h-10 w-10 overflow-hidden rounded-[var(--radius-xs)] border border-border">
                    {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : null}
                  </span>
                  <span className="font-mono text-[9px] text-faint">F{a.frame_number}</span>
                </button>
              );
            })}
        </div>
      ) : (
        <p className="text-[11px] text-faint">點角色名稱才會送進上下文。未點選就不會假裝已選。</p>
      )}
    </div>
  );
}
