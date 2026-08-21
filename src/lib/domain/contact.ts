import type { ConsistencyCategory } from "./types.ts";

export type TrackPoint = {
  name: string;
  x: number;
  y: number;
  frame_number: number;
};

export type ContactEvent = {
  frame: number;
  category: Extract<ConsistencyCategory, "CONTACT">;
  severity: "warning" | "error";
  pair: [string, string];
  distance: number;
  median: number;
  note: string;
};

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/**
 * Rule-based contact breaks from manual tracking points.
 * Not a hand/object model. Requires two named tracks visible on the same frames.
 */
export function detectContactBreaks(points: TrackPoint[]): ContactEvent[] {
  const byName = new Map<string, TrackPoint[]>();
  for (const p of points) {
    const list = byName.get(p.name) ?? [];
    list.push(p);
    byName.set(p.name, list);
  }
  const names = [...byName.keys()];
  if (names.length < 2) return [];
  const events: ContactEvent[] = [];
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const a = new Map((byName.get(names[i]) ?? []).map((p) => [p.frame_number, p]));
      const b = new Map((byName.get(names[j]) ?? []).map((p) => [p.frame_number, p]));
      const frames = [...a.keys()].filter((f) => b.has(f)).sort((x, y) => x - y);
      if (frames.length < 3) continue;
      const distances = frames.map((f) => dist(a.get(f)!, b.get(f)!));
      const sorted = [...distances].sort((x, y) => x - y);
      const median = sorted[Math.floor(sorted.length / 2)] || 1;
      for (let k = 1; k < frames.length; k += 1) {
        const d = distances[k];
        const prev = distances[k - 1];
        const jumped = d > median * 2.4 && d > prev * 1.8 && d > 18;
        if (!jumped) continue;
        events.push({
          frame: frames[k],
          category: "CONTACT",
          severity: d > median * 4 ? "error" : "warning",
          pair: [names[i], names[j]],
          distance: Math.round(d * 10) / 10,
          median: Math.round(median * 10) / 10,
          note: "接觸中斷：依追蹤點距離判斷，不是姿態模型。",
        });
      }
    }
  }
  return events;
}
