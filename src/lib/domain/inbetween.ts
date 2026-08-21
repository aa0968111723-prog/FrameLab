import { fail } from "./errors";

export type InbetweenPlan = {
  extra: number;
  fillFrom: number;
  fillTo: number;
  newB: number;
  target: number;
};

/** How many GENERATED slots to materialize between two keys. Never deletes. */
export function planInbetweenSlots(
  frameA: number,
  frameB: number,
  count?: number,
): InbetweenPlan {
  if (!Number.isInteger(frameA) || !Number.isInteger(frameB) || frameB - frameA < 1) {
    fail("INVALID_FRAME_RANGE", "Need frameB > frameA");
  }
  const existing = frameB - frameA - 1;
  const target = count == null ? Math.max(existing, 0) : Math.round(count);
  if (target < 1) {
    fail("INVALID_FRAME_RANGE", "Need at least one in-between slot (count >= 1 or a gap)");
  }
  if (target > 120) fail("INVALID_FRAME_RANGE", "count cap is 120");
  const extra = Math.max(0, target - existing);
  const newB = frameB + extra;
  return {
    extra,
    fillFrom: frameA + 1,
    fillTo: newB - 1,
    newB,
    target,
  };
}
