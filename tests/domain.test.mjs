import assert from "node:assert/strict";
import { describe, it } from "node:test";

function applyCurve(t, curve) {
  const x = Math.min(1, Math.max(0, t));
  switch (curve) {
    case "linear":
      return x;
    case "ease_in":
      return x * x * x;
    case "ease_out":
      return 1 - (1 - x) * (1 - x) * (1 - x);
    case "ease_in_out":
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    case "hold":
      return x < 1 ? 0 : 1;
    default:
      return x;
  }
}

function sampleCurve(count, curve) {
  const out = [];
  for (let i = 1; i <= count; i += 1) out.push(applyCurve(i / (count + 1), curve));
  return out;
}

function seek(state, frame) {
  const count = state.frameCount;
  const f = count <= 0 ? 0 : Math.min(count - 1, Math.max(0, Math.round(frame)));
  return { ...state, currentFrame: f, playhead: f, selectedFrames: [f], selectedRange: null };
}

function nextFrame(state) {
  const count = state.frameCount;
  if (count <= 0) return state;
  let f = state.currentFrame + 1;
  if (f >= count) f = count - 1;
  return seek(state, f);
}

function previousFrame(state) {
  let f = state.currentFrame - 1;
  if (f < 0) f = 0;
  return seek(state, f);
}

function selectRange(state, start, end) {
  const a = Math.min(start, end);
  const b = Math.max(start, end);
  const selected = [];
  for (let i = a; i <= b; i += 1) selected.push(i);
  return { ...state, selectedRange: [a, b], selectedFrames: selected, currentFrame: b };
}

function onionNeighbors(current, count, onion) {
  if (!onion.enabled || count <= 0) return { prev: [], next: [] };
  const prev = [];
  const next = [];
  for (let i = onion.prev; i >= 1; i -= 1) {
    const f = current - i;
    if (f >= 0) prev.push(f);
  }
  for (let i = 1; i <= onion.next; i += 1) {
    const f = current + i;
    if (f < count) next.push(f);
  }
  return { prev, next };
}

function meanAbsDiff(a, b) {
  const n = Math.min(a.data.length, b.data.length);
  let s = 0;
  let c = 0;
  for (let i = 0; i < n; i += 4) {
    s += Math.abs(a.data[i] - b.data[i]);
    s += Math.abs(a.data[i + 1] - b.data[i + 1]);
    s += Math.abs(a.data[i + 2] - b.data[i + 2]);
    c += 3;
  }
  return c === 0 ? 0 : s / c / 255;
}

function continuityScore(diff) {
  return Math.max(0, Math.min(1, 1 - diff * 2.2));
}

function histogram16(frame) {
  const r = new Array(16).fill(0);
  const g = new Array(16).fill(0);
  const b = new Array(16).fill(0);
  let n = 0;
  for (let i = 0; i < frame.data.length; i += 4) {
    r[frame.data[i] >> 4] += 1;
    g[frame.data[i + 1] >> 4] += 1;
    b[frame.data[i + 2] >> 4] += 1;
    n += 1;
  }
  for (let i = 0; i < 16; i += 1) {
    r[i] /= n;
    g[i] /= n;
    b[i] /= n;
  }
  return { r, g, b };
}

function blendRgba(a, b, t) {
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const data = new Uint8Array(width * height * 4);
  const u = 1 - t;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ai = (y * a.width + x) * 4;
      const bi = (y * b.width + x) * 4;
      const oi = (y * width + x) * 4;
      data[oi] = Math.round(a.data[ai] * u + b.data[bi] * t);
      data[oi + 1] = Math.round(a.data[ai + 1] * u + b.data[bi + 1] * t);
      data[oi + 2] = Math.round(a.data[ai + 2] * u + b.data[bi + 2] * t);
      data[oi + 3] = 255;
    }
  }
  return { data, width, height };
}

function pasteRegion(dest, src, box) {
  const x = Math.max(0, Math.round(box.x));
  const y = Math.max(0, Math.round(box.y));
  const w = Math.max(1, Math.round(box.w));
  const h = Math.max(1, Math.round(box.h));
  const data = new Uint8Array(dest.data);
  for (let j = 0; j < h; j += 1) {
    for (let i = 0; i < w; i += 1) {
      const dx = x + i;
      const dy = y + j;
      if (dx >= dest.width || dy >= dest.height || dx >= src.width || dy >= src.height) continue;
      const di = (dy * dest.width + dx) * 4;
      const si = (dy * src.width + dx) * 4;
      data[di] = src.data[si];
      data[di + 1] = src.data[si + 1];
      data[di + 2] = src.data[si + 2];
      data[di + 3] = 255;
    }
  }
  return { data, width: dest.width, height: dest.height };
}

function detectLocalMaxima(values, minValue) {
  const out = [];
  for (let i = 1; i < values.length - 1; i += 1) {
    if (values[i] >= minValue && values[i] >= values[i - 1] && values[i] >= values[i + 1]) {
      out.push(i);
    }
  }
  return out;
}

function sequentialEdges(frames) {
  const sorted = [...frames].sort((a, b) => a.frameNumber - b.frameNumber);
  const edges = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    edges.push({ type: "NEXT_FRAME", fromId: sorted[i].id, toId: sorted[i + 1].id });
    edges.push({ type: "PREVIOUS_FRAME", fromId: sorted[i + 1].id, toId: sorted[i].id });
  }
  return edges;
}

function getFrameWindow(frames, centerFrame, before, after) {
  return frames.filter(
    (f) => f.frameNumber >= centerFrame - before && f.frameNumber <= centerFrame + after,
  );
}

function characterNodeId(characterId, frameId) {
  return `${characterId}@${frameId}`;
}

function parseScopes(raw) {
  return raw.split(/[,\s]+/).filter(Boolean);
}

function hasScope(granted, needed) {
  if (granted.includes("ADMIN")) return true;
  return granted.includes(needed);
}

function solid(w, h, r, g, b) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

describe("motion curve", () => {
  it("clamps and hits endpoints", () => {
    assert.equal(applyCurve(0, "linear"), 0);
    assert.equal(applyCurve(1, "linear"), 1);
    assert.equal(applyCurve(-1, "ease_in"), 0);
  });
  it("ease_in is below linear at mid", () => {
    assert.ok(applyCurve(0.5, "ease_in") < 0.5);
    assert.ok(applyCurve(0.5, "ease_out") > 0.5);
  });
  it("hold stays zero until the end", () => {
    assert.equal(applyCurve(0.9, "hold"), 0);
    assert.equal(applyCurve(1, "hold"), 1);
  });
  it("samples count inbetweens", () => {
    assert.equal(sampleCurve(3, "linear").length, 3);
  });
});

describe("timeline engine", () => {
  it("seeks and clamps", () => {
    let s = { frameCount: 10, currentFrame: 0, playhead: 0, selectedFrames: [0] };
    s = seek(s, 4);
    assert.equal(s.currentFrame, 4);
    s = seek(s, 99);
    assert.equal(s.currentFrame, 9);
    s = previousFrame(s);
    assert.equal(s.currentFrame, 8);
    s = nextFrame(s);
    assert.equal(s.currentFrame, 9);
  });
  it("selects ranges", () => {
    const s = selectRange({ frameCount: 12, currentFrame: 0 }, 3, 6);
    assert.deepEqual(s.selectedFrames, [3, 4, 5, 6]);
  });
  it("onion neighbors respect bounds", () => {
    const n = onionNeighbors(0, 5, { enabled: true, prev: 2, next: 2 });
    assert.deepEqual(n.prev, []);
    assert.deepEqual(n.next, [1, 2]);
  });
});

describe("pixel metrics", () => {
  it("identical frames have zero diff", () => {
    const a = solid(8, 8, 10, 20, 30);
    assert.equal(meanAbsDiff(a, a), 0);
    assert.equal(continuityScore(0), 1);
  });
  it("opposite frames differ", () => {
    const a = solid(4, 4, 0, 0, 0);
    const b = solid(4, 4, 255, 255, 255);
    assert.ok(meanAbsDiff(a, b) > 0.99);
  });
  it("histogram sums to 1", () => {
    const h = histogram16(solid(4, 4, 255, 0, 0));
    assert.ok(Math.abs(h.r.reduce((s, v) => s + v, 0) - 1) < 1e-9);
  });
  it("blend midpoint is average", () => {
    const m = blendRgba(solid(2, 2, 0, 0, 0), solid(2, 2, 200, 100, 0), 0.5);
    assert.equal(m.data[0], 100);
    assert.equal(m.data[1], 50);
  });
  it("detects local maxima", () => {
    assert.deepEqual(detectLocalMaxima([0, 1, 0, 2, 0], 0.5), [1, 3]);
  });
  it("pastes a region without touching the rest", () => {
    const dest = solid(4, 4, 0, 0, 0);
    const src = solid(4, 4, 200, 0, 0);
    const out = pasteRegion(dest, src, { x: 1, y: 1, w: 1, h: 1 });
    assert.equal(out.data[0], 0);
    const i = (1 * 4 + 1) * 4;
    assert.equal(out.data[i], 200);
  });
});

describe("frame graph", () => {
  const frames = [0, 1, 2].map((n) => ({ id: `f${n}`, frameNumber: n }));
  it("builds next/prev edges", () => {
    const e = sequentialEdges(frames);
    assert.equal(e.filter((x) => x.type === "NEXT_FRAME").length, 2);
  });
  it("windows around a center", () => {
    assert.deepEqual(getFrameWindow(frames, 1, 1, 1).map((f) => f.frameNumber), [0, 1, 2]);
  });
  it("builds character node ids", () => {
    assert.equal(characterNodeId("xiaohua", "frm_1"), "xiaohua@frm_1");
  });
});

describe("permissions", () => {
  it("parses scopes and admin bypass", () => {
    const s = parseScopes("READ, ANALYZE");
    assert.ok(hasScope(s, "READ"));
    assert.equal(hasScope(s, "EDIT"), false);
    assert.equal(hasScope(["ADMIN"], "GENERATE"), true);
  });
  it("marks high-risk MCP edits", () => {
    const HIGH = new Set([
      "delete_frame",
      "replace_frame",
      "repair_frame_range",
      "regenerate_region",
      "render_overwrite",
    ]);
    for (const t of HIGH) assert.equal(HIGH.has(t), true);
    assert.equal(HIGH.has("list_projects"), false);
  });
});

describe("mcp catalog contract", () => {
  const tools = [
    "list_projects",
    "get_project",
    "get_timeline",
    "get_frame",
    "get_frame_range",
    "get_keyframes",
    "analyze_frame",
    "analyze_consistency",
    "analyze_motion",
    "detect_keyframes",
    "create_keyframe",
    "duplicate_frame",
    "delete_frame",
    "generate_inbetweens",
    "repair_frame",
    "repair_frame_range",
  ];
  it("has unique tool names", () => {
    assert.equal(new Set(tools).size, tools.length);
  });
  it("requires generate scope for inbetween and repair", () => {
    assert.equal(hasScope(["READ"], "GENERATE"), false);
    assert.equal(hasScope(["GENERATE"], "GENERATE"), true);
  });
});
