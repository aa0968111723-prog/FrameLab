import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nccTrack } from "../src/lib/domain/ncc-tracker.ts";

function blank(w, h, shade = 18) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = shade;
    data[i + 1] = shade;
    data[i + 2] = shade;
    data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

function stampSquare(frame, cx, cy, size = 9) {
  const half = Math.floor(size / 2);
  for (let y = cy - half; y <= cy + half; y += 1) {
    for (let x = cx - half; x <= cx + half; x += 1) {
      if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) continue;
      const i = (y * frame.width + x) * 4;
      const edge = x === cx - half || x === cx + half || y === cy - half || y === cy + half;
      const v = edge ? 240 : x === cx && y === cy ? 40 : 200;
      frame.data[i] = v;
      frame.data[i + 1] = v;
      frame.data[i + 2] = v + 4;
    }
  }
}

describe("ncc tracker", () => {
  it("follows a moving square within 3px", () => {
    const frames = [];
    const truth = [];
    for (let f = 0; f < 16; f += 1) {
      const x = 12 + f * 3;
      const y = 40;
      const frame = blank(80, 80);
      stampSquare(frame, x, y);
      frames.push(frame);
      truth.push({ x, y });
    }
    const track = nccTrack(frames, { x: 12, y: 40, frameIndex: 0 }, { patch: 9, search: 8, minScore: 0.5 });
    for (let i = 0; i < truth.length; i += 1) {
      assert.ok(Math.abs(track[i].x - truth[i].x) <= 2, `frame ${i} x ${track[i].x} vs ${truth[i].x} (${track[i].status} ${track[i].score?.toFixed?.(2)})`);
      assert.ok(Math.abs(track[i].y - truth[i].y) <= 2, `frame ${i} y ${track[i].y} vs ${truth[i].y}`);
      assert.ok(track[i].status === "visible" || track[i].status === "recovered");
    }
  });

  it("marks a disappearance as occluded then lost", () => {
    const frames = [];
    for (let f = 0; f < 10; f += 1) {
      const frame = blank(80, 80);
      if (f < 3 || f > 7) stampSquare(frame, 20 + (f < 3 ? f : 0), 40);
      frames.push(frame);
    }
    const track = nccTrack(frames, { x: 20, y: 40, frameIndex: 0 }, { patch: 9, search: 8, minScore: 0.7 });
    assert.ok(track.some((s) => s.status === "occluded" || s.status === "lost"));
    assert.equal(track[0].status, "visible");
  });
});
