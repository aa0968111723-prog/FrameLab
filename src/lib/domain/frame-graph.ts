import type {
  CharacterTrackRow,
  EdgeType,
  FrameRecord,
  TrackStatus,
} from "./types.ts";

export type GraphNodeKind =
  | "frame"
  | "character"
  | "object"
  | "pose"
  | "track"
  | "region"
  | "keyframe"
  | "repair";

export type GraphEdge = {
  id: string;
  type: EdgeType;
  fromKind: GraphNodeKind;
  fromId: string;
  toKind: GraphNodeKind;
  toId: string;
  payload?: Record<string, unknown>;
};

export type FrameGraphSnapshot = {
  frames: FrameRecord[];
  edges: GraphEdge[];
};

export function sequentialEdges(frames: FrameRecord[]): GraphEdge[] {
  const sorted = [...frames].sort((a, b) => a.frameNumber - b.frameNumber);
  const edges: GraphEdge[] = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i];
    const b = sorted[i + 1];
    edges.push({
      id: `e_next_${a.id}_${b.id}`,
      type: "NEXT_FRAME",
      fromKind: "frame",
      fromId: a.id,
      toKind: "frame",
      toId: b.id,
    });
    edges.push({
      id: `e_prev_${b.id}_${a.id}`,
      type: "PREVIOUS_FRAME",
      fromKind: "frame",
      fromId: b.id,
      toKind: "frame",
      toId: a.id,
    });
  }
  return edges;
}

export function betweenEdges(startId: string, generatedIds: string[], endId: string): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const gid of generatedIds) {
    if (!gid || gid === startId || gid === endId) continue;
    edges.push({
      id: `e_between_start_${startId}_${gid}`,
      type: "BETWEEN",
      fromKind: "frame",
      fromId: startId,
      toKind: "frame",
      toId: gid,
    });
    edges.push({
      id: `e_between_end_${gid}_${endId}`,
      type: "BETWEEN",
      fromKind: "frame",
      fromId: gid,
      toKind: "frame",
      toId: endId,
    });
    edges.push({
      id: `e_gen_from_${startId}_${gid}`,
      type: "GENERATED_FROM",
      fromKind: "frame",
      fromId: startId,
      toKind: "frame",
      toId: gid,
    });
    edges.push({
      id: `e_gen_from_${endId}_${gid}`,
      type: "GENERATED_FROM",
      fromKind: "frame",
      fromId: endId,
      toKind: "frame",
      toId: gid,
    });
  }
  return edges;
}

export function getFrameWindow(
  frames: FrameRecord[],
  centerFrame: number,
  before: number,
  after: number,
): FrameRecord[] {
  const sorted = [...frames].sort((a, b) => a.frameNumber - b.frameNumber);
  return sorted.filter(
    (f) =>
      f.frameNumber >= centerFrame - before &&
      f.frameNumber <= centerFrame + after,
  );
}

export function getMotionBetween(
  frames: FrameRecord[],
  frameA: number,
  frameB: number,
): FrameRecord[] {
  const lo = Math.min(frameA, frameB);
  const hi = Math.max(frameA, frameB);
  return [...frames]
    .filter((f) => f.frameNumber >= lo && f.frameNumber <= hi)
    .sort((a, b) => a.frameNumber - b.frameNumber);
}

export function neighborsOf(
  edges: GraphEdge[],
  nodeId: string,
  type?: EdgeType,
): GraphEdge[] {
  return edges.filter(
    (e) =>
      (e.fromId === nodeId || e.toId === nodeId) &&
      (type ? e.type === type : true),
  );
}

export function characterNodeId(characterId: string, frameId: string): string {
  return `${characterId}@${frameId}`;
}

export function objectNodeId(objectId: string, frameId: string): string {
  return `${objectId}@${frameId}`;
}

export function poseNodeId(frameId: string): string {
  return `pose:${frameId}`;
}

export function regionNodeId(frameId: string, kind: string): string {
  return `region:${kind}@${frameId}`;
}

export function keyframeNodeId(frameId: string): string {
  return `key:${frameId}`;
}

export function repairNodeId(frameId: string): string {
  return `repair:${frameId}`;
}

export function trackNodeId(trackId: string, frameNumber: number): string {
  return `${trackId}@F${frameNumber}`;
}

export type TrackAppearance = {
  frame_number: number;
  frame_id?: string | null;
  visible: boolean;
  occluded: boolean;
};

/**
 * Derive visible / occluded / lost / recovered along a character or object track.
 * Lost = a hole between first and last appearance. Recovered = first hit after a hole.
 * Not a tracker model.
 */
export function annotateCharacterTrack(
  appearances: TrackAppearance[],
): CharacterTrackRow[] {
  if (appearances.length === 0) return [];
  const byFrame = new Map<number, TrackAppearance>();
  for (const a of appearances) byFrame.set(a.frame_number, a);
  const numbers = [...byFrame.keys()].sort((x, y) => x - y);
  const first = numbers[0];
  const last = numbers[numbers.length - 1];
  const out: CharacterTrackRow[] = [];
  let sawGap = false;
  for (let n = first; n <= last; n += 1) {
    const a = byFrame.get(n);
    if (!a) {
      out.push({
        frameNumber: n,
        frameId: null,
        visible: false,
        occluded: false,
        status: "lost",
      });
      sawGap = true;
      continue;
    }
    let status: TrackStatus = "visible";
    if (a.occluded) status = "occluded";
    else if (sawGap) {
      status = "recovered";
      sawGap = false;
    }
    out.push({
      frameNumber: n,
      frameId: a.frame_id ?? null,
      visible: a.visible,
      occluded: a.occluded,
      status,
    });
  }
  return out;
}
