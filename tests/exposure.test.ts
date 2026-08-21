import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  drawingAtTick,
  drawingAtX,
  expandPlaybackSlots,
  exposureLabel,
  exposureTicks,
  layoutExposureStrip,
  playbackLength,
} from "../src/lib/domain/exposure.ts";
import { frameDurationMs } from "../src/lib/domain/fps.ts";
import { tickDurationMs } from "../src/lib/domain/exposure.ts";

const drawings = [
  { id: "a", frameNumber: 0, exposureCount: 1 },
  { id: "b", frameNumber: 1, exposureCount: 2 },
  { id: "c", frameNumber: 2, exposureCount: 3 },
];

describe("animation exposure", () => {
  it("labels ones / twos / threes", () => {
    assert.equal(exposureLabel(1), "一拍一");
    assert.equal(exposureLabel(2), "一拍二");
    assert.equal(exposureLabel(3), "一拍三");
  });

  it("one drawing occupies N playback ticks, not N images", () => {
    const slots = expandPlaybackSlots(drawings);
    assert.equal(slots.length, 6);
    assert.equal(playbackLength(drawings), 6);
    assert.equal(new Set(slots.map((s) => s.drawingId)).size, 3);
    assert.deepEqual(slots.filter((s) => s.drawingId === "b").map((s) => s.localTick), [0, 1]);
    assert.equal(drawingAtTick(drawings, 1)?.drawingId, "b");
    assert.equal(drawingAtTick(drawings, 2)?.drawingId, "b");
    assert.equal(drawingAtTick(drawings, 3)?.drawingId, "c");
  });

  it("24fps hold length is ticks × 1/24s", () => {
    assert.equal(frameDurationMs(24, 1), tickDurationMs(24));
    assert.equal(frameDurationMs(24, 2), tickDurationMs(24) * 2);
    assert.equal(frameDurationMs(24, 3), tickDurationMs(24) * 3);
    assert.equal(exposureTicks(2), 2);
  });

  it("timeline cell width follows exposure ticks", () => {
    const { cells, totalTicks, totalWidth } = layoutExposureStrip(drawings, 10);
    assert.equal(totalTicks, 6);
    assert.equal(totalWidth, 60);
    assert.equal(cells[0]!.width, 10);
    assert.equal(cells[1]!.width, 20);
    assert.equal(cells[2]!.width, 30);
    assert.equal(drawingAtX(drawings, 15, 10), 1);
    assert.equal(drawingAtX(drawings, 40, 10), 2);
  });

  it("export and timeline expand ticks without duplicating artwork rows", () => {
    const concat = fs.readFileSync(path.join(process.cwd(), "src/lib/media/ffmpeg.ts"), "utf8");
    const png = fs.readFileSync(path.join(process.cwd(), "src/lib/commands/inbetween-tools.ts"), "utf8");
    const studio = fs.readFileSync(path.join(process.cwd(), "src/components/workstation/studio-app.tsx"), "utf8");
    const tl = fs.readFileSync(path.join(process.cwd(), "src/components/workstation/visual-timeline.tsx"), "utf8");
    assert.match(concat, /exposureTicks/);
    assert.match(concat, /await link\(/);
    assert.match(png, /exposureTicks\(f\.exposure_count\)/);
    assert.match(studio, /tickDurationMs/);
    assert.match(studio, /exposureTicks\(f\.exposureCount\)/);
    assert.match(tl, /layoutExposureStrip/);
    assert.doesNotMatch(concat, /insertFrame/);
  });
});
