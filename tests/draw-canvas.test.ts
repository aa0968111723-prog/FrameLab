import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  clampBrushSize,
  DEFAULT_BRUSH_SIZE,
  isDrawTool,
  jpegFromDataUrl,
  shouldPanPointer,
  strokeWidth,
} from "../src/lib/visual/draw-canvas.ts";

describe("draw canvas math", () => {
  it("clamps brush size", () => {
    assert.equal(clampBrushSize(8), 8);
    assert.equal(clampBrushSize(0), 1);
    assert.equal(clampBrushSize(99), 48);
    assert.equal(clampBrushSize(Number.NaN), DEFAULT_BRUSH_SIZE);
  });

  it("scales stroke by pressure without going to zero", () => {
    assert.ok(strokeWidth(8, 1) >= 8 * 0.9);
    assert.ok(strokeWidth(8, 0.2) < strokeWidth(8, 1));
    assert.ok(strokeWidth(8, 0) >= 1);
  });

  it("strips jpeg data-url prefix", () => {
    assert.equal(jpegFromDataUrl("data:image/jpeg;base64,abc"), "abc");
    assert.equal(jpegFromDataUrl("abc"), "abc");
  });

  it("draw tools are brush and eraser only", () => {
    assert.equal(isDrawTool("brush"), true);
    assert.equal(isDrawTool("eraser"), true);
    assert.equal(isDrawTool("pan"), false);
    assert.equal(isDrawTool("region"), false);
  });

  it("middle / alt / two-finger pan instead of drawing", () => {
    assert.equal(shouldPanPointer({ tool: "brush", button: 0, altKey: false, pointerCount: 1 }), false);
    assert.equal(shouldPanPointer({ tool: "brush", button: 1, altKey: false, pointerCount: 1 }), true);
    assert.equal(shouldPanPointer({ tool: "eraser", button: 0, altKey: true, pointerCount: 1 }), true);
    assert.equal(shouldPanPointer({ tool: "brush", button: 0, altKey: false, pointerCount: 2 }), true);
    assert.equal(shouldPanPointer({ tool: "pan", button: 0, altKey: false, pointerCount: 1 }), true);
  });
});

describe("draw canvas wiring", () => {
  it("studio and canvas expose brush/eraser and write the current frame", () => {
    const canvas = fs.readFileSync(path.join(process.cwd(), "src/components/workstation/animation-canvas.tsx"), "utf8");
    const studio = fs.readFileSync(path.join(process.cwd(), "src/components/workstation/studio-app.tsx"), "utf8");
    assert.match(canvas, /"brush" \| "eraser"/);
    assert.match(canvas, /onPointerDown/);
    assert.match(canvas, /onPointerCancel/);
    assert.match(canvas, /setPointerCapture/);
    assert.match(canvas, /touch-none/);
    assert.match(canvas, /onPaintCommit/);
    assert.match(studio, /畫筆/);
    assert.match(studio, /橡皮擦/);
    assert.match(studio, /replace_frame/);
    assert.match(studio, /復原/);
  });
});
