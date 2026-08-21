import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { layoutExposureStrip } from "../src/lib/domain/exposure.ts";
import {
  cellIndexAtX,
  sliceVisible,
  timelineDomEstimate,
  timelineWindow,
  visibleCellRange,
  visibleFlowSegments,
  visibleSpans,
} from "../src/lib/visual/timeline-virtual.ts";
import { neighborIds, ThumbnailCache } from "../src/lib/visual/thumbnail-cache.ts";

const TOTALS = [1000, 5000, 10000] as const;
const VIEW = 800;
const CELL = 40;

function makeCells(total: number, cell = CELL) {
  return Array.from({ length: total }, (_, i) => ({
    id: `f${i}`,
    frameNumber: i,
    drawingIndex: i,
    startTick: i,
    ticks: 1,
    left: i * cell,
    width: cell,
  }));
}

function makeFrames(total: number) {
  return Array.from({ length: total }, (_, i) => ({
    id: `f${i}`,
    frameNumber: i,
    frameType: i % 24 === 0 ? "KEY" : "INBETWEEN",
    exposureCount: 1,
  }));
}

function domCount(total: number, scrollLeft: number) {
  const cells = makeCells(total);
  const slice = sliceVisible(cells, scrollLeft, VIEW, CELL * 8);
  const flow = [];
  for (let i = 0; i < total; i += 12) {
    flow.push({ key: i, nextKey: Math.min(total - 1, i + 12) });
  }
  const start = slice[0]?.frameNumber ?? 0;
  const end = slice[slice.length - 1]?.frameNumber ?? start;
  const flowInView = visibleFlowSegments(flow, start, end);
  const spansInView = visibleSpans(
    [{ start: 100, end: 140, severity: "warning" }],
    start,
    end,
  );
  return slice.length + flowInView.length + spansInView.length + 8;
}

describe("timeline performance", () => {
  it("virtual window stays bounded at 1000 / 5000 / 10000 frames", () => {
    const counts: number[] = [];
    for (const total of TOTALS) {
      const win = timelineWindow({
        scrollLeft: 12_000,
        containerWidth: VIEW,
        cellWidth: CELL,
        total,
      });
      assert.ok(win.visibleCount < 80, `${total} visible ${win.visibleCount}`);
      assert.equal(win.totalWidth, total * CELL);
      const cells = makeCells(total);
      const range = visibleCellRange(cells, 12_000, VIEW, CELL * 8);
      const visible = range.end - range.start;
      assert.ok(visible < 80, `${total} slice ${visible}`);
      assert.ok(visible > 0);
      const nodes = domCount(total, 12_000);
      assert.ok(nodes < 100, `${total} DOM estimate ${nodes}`);
      counts.push(nodes);
      const est = timelineDomEstimate({
        containerWidth: VIEW,
        cellWidth: CELL,
        total,
        flowInView: 4,
        spansInView: 1,
      });
      assert.ok(est < 100);
    }
    assert.ok(Math.abs(counts[0]! - counts[2]!) < 20, `DOM grew ${counts}`);
  });

  it("binary slice of 10000 cells is fast and independent of n", () => {
    const cells = makeCells(10_000);
    const t0 = performance.now();
    let seen = 0;
    for (let s = 0; s < 400; s += 1) {
      const slice = sliceVisible(cells, s * CELL, VIEW, CELL * 8);
      seen += slice.length;
      assert.ok(slice.length < 80);
    }
    const dt = performance.now() - t0;
    assert.ok(seen > 0);
    assert.ok(dt < 80, `400 slices of 10000 took ${dt.toFixed(2)}ms`);
    const idx = cellIndexAtX(cells, 12345);
    assert.equal(cells[idx]?.frameNumber, Math.floor(12345 / CELL));
  });

  it("thumbnail LRU stays bounded after 10000 inserts", () => {
    const cache = new ThumbnailCache(64);
    for (let i = 0; i < 10_000; i += 1) cache.set(`f${i}`, `/thumb/${i}.jpg`);
    assert.equal(cache.size, 64);
    assert.ok(cache.evictions >= 10_000 - 64);
    assert.equal(cache.get("f9999"), "/thumb/9999.jpg");
    assert.equal(cache.get("f0"), undefined);
    const frames = Array.from({ length: 10_000 }, (_, i) => ({ id: `f${i}`, frameNumber: i }));
    const warmed = cache.preloadNeighbors(frames, 5000, (id) => `/thumb/${id}.jpg`, 8);
    assert.equal(warmed.length, 17);
    assert.ok(cache.size <= 64);
  });

  it("neighbor preload is O(radius), not O(n)", () => {
    for (const total of TOTALS) {
      const frames = Array.from({ length: total }, (_, i) => ({ id: `f${i}`, frameNumber: i }));
      const t0 = performance.now();
      const ids = neighborIds(frames, Math.floor(total / 2), 8);
      const dt = performance.now() - t0;
      assert.equal(ids.length, 17);
      assert.ok(dt < 15, `neighborIds(${total}) took ${dt.toFixed(2)}ms`);
    }
  });

  it("layout + window of 10000 drawings does not build a linear DOM budget", () => {
    const frames = makeFrames(10_000);
    const t0 = performance.now();
    const layout = layoutExposureStrip(frames, CELL);
    const slice = sliceVisible(layout.cells, 80_000, VIEW, CELL * 8);
    const dt = performance.now() - t0;
    assert.equal(layout.cells.length, 10_000);
    assert.ok(slice.length < 80, `visible cells ${slice.length}`);
    assert.ok(dt < 80, `layout+slice 10000 took ${dt.toFixed(2)}ms`);
    const a = domCount(1000, 4000);
    const b = domCount(5000, 4000);
    const c = domCount(10_000, 4000);
    assert.ok(a < 100 && b < 100 && c < 100, `DOM ${a}/${b}/${c}`);
    assert.ok(Math.abs(a - c) < 20);
  });
});
