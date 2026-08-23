import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  histogram16,
  level1PixelMetrics,
  meanLuma,
  type RgbaFrame,
} from "../src/lib/domain/pixel-metrics.ts";

function solid(width: number, height: number, r: number, g: number, b: number): RgbaFrame {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { data, width, height };
}

describe("level1 pixel metrics", () => {
  it("luma on a known gray image is meanLuma, not undefined or a constant", () => {
    const frame = solid(8, 8, 128, 128, 128);
    const level1 = level1PixelMetrics(frame);
    const expected = meanLuma(frame);
    assert.equal(level1.luma, expected);
    assert.ok(typeof level1.luma === "number" && Number.isFinite(level1.luma));
    assert.notEqual(level1.luma, undefined);
    // Rec.709 of 128/255 is ~0.502, never 0 and never missing.
    assert.ok(level1.luma > 0.49 && level1.luma < 0.51, `luma=${level1.luma}`);
    assert.equal("mae_self" in level1, false);
    const hist = histogram16(frame);
    assert.deepEqual(level1.histogram, hist);
    assert.equal(level1.provider, "pixel-metrics");
  });

  it("black and white frames differ", () => {
    const black = level1PixelMetrics(solid(4, 4, 0, 0, 0));
    const white = level1PixelMetrics(solid(4, 4, 255, 255, 255));
    assert.equal(black.luma, 0);
    assert.ok(white.luma > 0.99);
    assert.notEqual(black.luma, white.luma);
  });

  it("analyze_frame actually calls the metric, does not cache undefined luma", () => {
    const exec = fs.readFileSync(
      path.join(process.cwd(), "src", "lib", "commands", "execute.ts"),
      "utf8",
    );
    const start = exec.indexOf("async function analyzeFrame");
    const end = exec.indexOf("async function analyzeRange");
    const body = exec.slice(start, end);
    assert.match(
      body,
      /level1PixelMetrics|meanLuma\(/,
      "analyze_frame must compute luma, not skip the imported pixel-metrics helpers",
    );
    assert.doesNotMatch(body, /luma:\s*rgba\.data\.length \? undefined/);
    assert.doesNotMatch(body, /mae_self:\s*0/);
  });
});
