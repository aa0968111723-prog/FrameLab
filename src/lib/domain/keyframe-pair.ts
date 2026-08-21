/** Keyframe pair validation. Does not generate pixels. */

import { fail } from "./errors.ts";

export type KeyframePairInput = {
  timelineId: string;
  startFrame: number;
  endFrame: number;
  desiredInbetweenCount?: number;
  startExists?: boolean;
  endExists?: boolean;
  startLockedInvalid?: boolean;
  endLockedInvalid?: boolean;
  startHasAsset?: boolean;
  endHasAsset?: boolean;
  startIsKey?: boolean;
  endIsKey?: boolean;
};

export type KeyframePair = {
  start_frame_number: number;
  end_frame_number: number;
  frame_gap: number;
  desired_inbetween_count: number;
  status: "draft" | "ready" | "invalid";
};

export function validateKeyframePair(input: KeyframePairInput): KeyframePair {
  const start = input.startFrame;
  const end = input.endFrame;
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    fail("INVALID_KEYFRAME_PAIR", "Keyframe numbers must be integers.");
  }
  if (start === end) fail("INVALID_KEYFRAME_PAIR", "Start and end cannot be the same frame.");
  if (start > end) fail("INVALID_KEYFRAME_PAIR", "Start frame must be before end frame.");
  if (input.startExists === false) fail("KEYFRAME_NOT_FOUND", `Start frame F${start} not found.`, 404);
  if (input.endExists === false) fail("KEYFRAME_NOT_FOUND", `End frame F${end} not found.`, 404);
  if (input.startHasAsset === false || input.endHasAsset === false) {
    fail("FRAME_ASSET_UNAVAILABLE", "A keyframe has no image asset.");
  }
  if (input.startLockedInvalid || input.endLockedInvalid) {
    fail("INVALID_KEYFRAME_PAIR", "Locked keyframe pair is in an invalid state.");
  }
  if (input.startIsKey === false || input.endIsKey === false) {
    fail("INVALID_KEYFRAME_PAIR", "Both ends must be KEY frames.");
  }
  const gap = end - start;
  // Frames that physically exist strictly between the two keys.
  const interior = Math.max(0, gap - 1);
  const desired = input.desiredInbetweenCount ?? interior;
  if (desired < 0) fail("INVALID_KEYFRAME_PAIR", "Inbetween count cannot be negative.");
  if (desired > 120) fail("INVALID_FRAME_RANGE", "count cap is 120");
  // generatedFrameNumbers() lays the results out as start+1 .. start+desired, so
  // a count larger than the interior runs onto the end key and past it, silently
  // overwriting frames that belong to the next span. Callers that genuinely want
  // to make room must shift the timeline first (planInbetweenSlots), not spill.
  if (desired > interior) {
    fail(
      "INVALID_FRAME_RANGE",
      `count ${desired} does not fit between F${start} and F${end}: ` +
        `only ${interior} interior frame${interior === 1 ? "" : "s"} available.`,
    );
  }
  return {
    start_frame_number: start,
    end_frame_number: end,
    frame_gap: gap,
    desired_inbetween_count: desired,
    status: "ready",
  };
}

export function generatedFrameNumbers(start: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= count; i += 1) out.push(start + i);
  return out;
}
