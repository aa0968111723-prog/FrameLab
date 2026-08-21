/** Character / object track visualization helpers. */

export type PresenceRow = {
  id: string;
  name: string;
  frames: Set<number>;
  occluded: Set<number>;
};

export function buildPresence(
  rows: { id?: string; character_id?: string; object_id?: string; name: string; frame_number: number; visible?: boolean; occluded?: boolean }[],
): PresenceRow[] {
  const map = new Map<string, PresenceRow>();
  for (const r of rows) {
    const id = r.id ?? r.character_id ?? r.object_id ?? r.name;
    const cur = map.get(id) ?? { id, name: r.name, frames: new Set<number>(), occluded: new Set<number>() };
    cur.frames.add(r.frame_number);
    if (r.occluded) cur.occluded.add(r.frame_number);
    map.set(id, cur);
  }
  return [...map.values()];
}

export type TrackBreak = { start: number; end: number; kind: "lost" | "occluded" };

/** Gaps inside [0, frameCount) where the character is missing. */
export function trackingBreaks(present: Set<number>, frameCount: number): TrackBreak[] {
  const out: TrackBreak[] = [];
  if (frameCount <= 0 || present.size === 0) return out;
  const min = Math.min(...present);
  const max = Math.max(...present);
  let gapStart: number | null = null;
  for (let i = min; i <= max; i += 1) {
    if (present.has(i)) {
      if (gapStart != null) {
        out.push({ start: gapStart, end: i - 1, kind: "lost" });
        gapStart = null;
      }
    } else if (gapStart == null) {
      gapStart = i;
    }
  }
  if (gapStart != null) out.push({ start: gapStart, end: max, kind: "lost" });
  return out;
}

export function isPresent(row: PresenceRow | undefined, frame: number): boolean {
  return Boolean(row?.frames.has(frame));
}
