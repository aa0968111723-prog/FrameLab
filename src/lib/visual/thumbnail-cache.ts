/** Neighbor preload list so timeline scrubbing does not hitch. */

export function neighborIds(
  frames: { id: string; frameNumber: number }[],
  current: number,
  radius = 3,
): string[] {
  const byNum = new Map(frames.map((f) => [f.frameNumber, f.id]));
  const out: string[] = [];
  for (let i = current - radius; i <= current + radius; i += 1) {
    const id = byNum.get(i);
    if (id) out.push(id);
  }
  return out;
}

export function sampleStripIndices(count: number, samples = 6): number[] {
  if (count <= 0) return [];
  if (count <= samples) return Array.from({ length: count }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    out.push(Math.round((i / (samples - 1)) * (count - 1)));
  }
  return [...new Set(out)];
}
