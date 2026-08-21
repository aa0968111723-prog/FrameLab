/** Track continuity / TRACK_BREAK from real NCC samples. */

import type { TrackStatus } from "./types.ts";

export type TrackSample = {
  name: string;
  frame: number;
  x: number;
  y: number;
  visibility?: number;
  confidence?: number;
  status: TrackStatus | string;
};

export type TrackBreak = {
  name: string;
  frame: number;
  kind: "TRACK_BREAK";
  from: string;
  to: string;
  jump: number;
  severity: "warning" | "error";
  note: string;
};

export function canonicalTrackStatus(
  status: string,
): "VISIBLE" | "OCCLUDED" | "LOST" | "RECOVERED" {
  const s = status.toLowerCase();
  if (s === "occluded") return "OCCLUDED";
  if (s === "lost") return "LOST";
  if (s === "recovered") return "RECOVERED";
  return "VISIBLE";
}

export function detectTrackBreaks(samples: TrackSample[]): TrackBreak[] {
  const byName = new Map<string, TrackSample[]>();
  for (const s of samples) {
    const list = byName.get(s.name) ?? [];
    list.push(s);
    byName.set(s.name, list);
  }
  const out: TrackBreak[] = [];
  for (const [name, list] of byName) {
    const ordered = [...list].sort((a, b) => a.frame - b.frame);
    for (let i = 1; i < ordered.length; i += 1) {
      const a = ordered[i - 1];
      const b = ordered[i];
      const from = canonicalTrackStatus(String(a.status));
      const to = canonicalTrackStatus(String(b.status));
      const jump = Math.hypot(b.x - a.x, b.y - a.y);
      const lost = to === "LOST" || (from === "VISIBLE" && to === "OCCLUDED" && jump > 24);
      const recovered = to === "RECOVERED";
      if (!lost && !recovered && jump < 40) continue;
      if (lost || recovered || jump >= 40) {
        out.push({
          name,
          frame: b.frame,
          kind: "TRACK_BREAK",
          from,
          to,
          jump: Math.round(jump * 10) / 10,
          severity: jump > 80 || to === "LOST" ? "error" : "warning",
          note:
            to === "LOST"
              ? `Track "${name}" lost at F${b.frame}.`
              : recovered
                ? `Track "${name}" recovered at F${b.frame} after a gap.`
                : `Track "${name}" jumped ${jump.toFixed(1)}px between F${a.frame} and F${b.frame}.`,
        });
      }
    }
  }
  return out;
}
