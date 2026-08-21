import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyCustomCurve } from "../src/lib/domain/motion-curve.ts";
import { planInbetweenSlots } from "../src/lib/domain/inbetween.ts";
import { smartSample } from "../src/lib/domain/smart-sample.ts";
import { detectContactBreaks } from "../src/lib/domain/contact.ts";
import { annotateCharacterTrack } from "../src/lib/domain/frame-graph.ts";
import {
  assertProjectScope,
  assertToolAllowed,
  TOOL_SCOPES,
  isHighRisk,
} from "../src/lib/domain/permissions.ts";
import { FrameLabError } from "../src/lib/domain/errors.ts";
import { checkRateLimit, resetRateLimitForTests } from "../src/lib/domain/rate-limit.ts";
import { ffmpegExtractArgs, clampExtractNumbers } from "../src/lib/media/ffmpeg.ts";
import { mapRestPath } from "../src/lib/framelab/rest-map.ts";
import { MCP_TOOLS, MCP_RESOURCE_TEMPLATES, MCP_PROMPTS, parseResourceUri } from "../src/lib/mcp/catalog.ts";
import { assertSafeId, STORAGE_DIRS } from "../src/lib/storage/local.ts";

const SPEC_TOOLS = [
  "list_projects", "get_project", "get_video", "get_timeline", "get_frame",
  "get_frame_range", "get_keyframes", "get_character", "get_character_track",
  "get_object_track", "get_consistency_results", "get_problem_frames", "get_job",
  "get_model_status", "analyze_frame", "analyze_frame_range", "analyze_pose",
  "analyze_motion", "analyze_tracking", "analyze_consistency", "detect_problem_frames",
  "detect_keyframes", "compare_frames", "create_keyframe", "remove_keyframe",
  "duplicate_frame", "replace_frame", "delete_frame", "set_frame_duration",
  "set_frame_type", "set_onion_skin", "create_character", "assign_character",
  "create_tracking_point", "generate_inbetweens", "interpolate_frames",
  "repair_frame", "repair_frame_range", "regenerate_region", "rerun_tracking",
  "rerun_motion", "rerun_consistency", "render_preview", "render_frame_range",
  "render_animation",
  "create_keyframe_range", "undo", "redo", "get_graph", "get_frame_analysis",
  "mark_inbetween", "assign_character_range", "list_audit_logs", "ingest_frames",
  "cancel_job", "list_mcp_clients",
];

describe("inbetween plan", () => {
  it("fills existing gap when count omitted", () => {
    const p = planInbetweenSlots(100, 110);
    assert.equal(p.target, 9);
    assert.equal(p.extra, 0);
    assert.equal(p.newB, 110);
  });
  it("inserts when adjacent keys and count is set", () => {
    const p = planInbetweenSlots(100, 101, 9);
    assert.equal(p.extra, 9);
    assert.equal(p.newB, 110);
    assert.equal(p.fillFrom, 101);
    assert.equal(p.fillTo, 109);
  });
  it("rejects inverted range", () => {
    assert.throws(() => planInbetweenSlots(5, 5), FrameLabError);
  });
});

describe("smart sample", () => {
  it("keeps endpoints and keys", () => {
    const s = smartSample({
      frameCount: 10,
      keys: [3],
      diffs: [0, 0.01, 0.01, 0.9, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01],
      histogramDistances: new Array(10).fill(0),
      magnitudes: new Array(10).fill(0),
    });
    const nums = s.map((x) => x.frameNumber);
    assert.ok(nums.includes(0));
    assert.ok(nums.includes(9));
    assert.ok(nums.includes(3));
  });
});

describe("contact breaks", () => {
  it("needs two tracks", () => {
    assert.equal(detectContactBreaks([{ name: "hand", x: 1, y: 1, frame_number: 0 }]).length, 0);
  });
  it("flags a sudden pair-distance jump", () => {
    const pts = [];
    for (let f = 0; f < 6; f += 1) {
      pts.push({ name: "hand", x: 10, y: 10, frame_number: f });
      pts.push({
        name: "case",
        x: f === 4 ? 120 : 14,
        y: 10,
        frame_number: f,
      });
    }
    const ev = detectContactBreaks(pts);
    assert.ok(ev.some((e) => e.frame === 4 && e.category === "CONTACT"));
  });
});

describe("permissions and catalog", () => {
  it("every catalog tool has a scope", () => {
    for (const t of MCP_TOOLS) {
      assert.ok(TOOL_SCOPES[t.name], `missing scope for ${t.name}`);
    }
  });
  it("covers spec v0.1 tool names", () => {
    const names = new Set(MCP_TOOLS.map((t) => t.name));
    for (const t of SPEC_TOOLS) {
      assert.ok(names.has(t), `missing MCP tool ${t}`);
    }
  });
  it("readonly cannot delete", () => {
    assert.throws(() => assertToolAllowed(["READ"], "delete_frame"), FrameLabError);
  });
  it("marks high-risk tools", () => {
    assert.equal(isHighRisk("repair_frame_range"), true);
    assert.equal(isHighRisk("extract_video"), true);
    assert.equal(isHighRisk("get_frame"), false);
  });
  it("isolates project scope", () => {
    assert.throws(() => assertProjectScope("prj_a", "prj_b"), FrameLabError);
    assertProjectScope("all", "prj_b");
    assertProjectScope("prj_b", "prj_b");
  });
  it("has required resource templates", () => {
    const uris = MCP_RESOURCE_TEMPLATES.map((r) => r.uriTemplate);
    assert.ok(uris.includes("framelab://videos/{video_id}"));
    assert.ok(uris.includes("framelab://characters/{character_id}/track"));
    assert.ok(uris.includes("framelab://objects/{object_id}"));
    assert.ok(uris.includes("framelab://objects/{object_id}/track"));
  });
  it("ships the seven MCP prompts", () => {
    assert.equal(MCP_PROMPTS.length, 7);
  });
});

describe("rate limit", () => {
  it("trips after the cap", () => {
    resetRateLimitForTests();
    for (let i = 0; i < 5; i += 1) checkRateLimit("t", 5);
    assert.throws(() => checkRateLimit("t", 5), FrameLabError);
  });
});

describe("ffmpeg argv", () => {
  it("never interpolates user strings into the filter", () => {
    const args = ffmpegExtractArgs({
      inputPath: "/workspace/data/projects/p/source/clip.mp4",
      outputDir: "/workspace/data/projects/p/frames",
      fps: 12,
      maxWidth: 640,
      maxFrames: 80,
    });
    assert.equal(args.includes("-i"), true);
    assert.ok(args.includes("fps=12,scale=640:-2:flags=lanczos"));
    assert.equal(args.includes("shell"), false);
  });
  it("clamps fps/width", () => {
    const c = clampExtractNumbers(99, 4000, 9999);
    assert.equal(c.fps, 30);
    assert.equal(c.maxWidth, 640);
    assert.equal(c.maxFrames, 160);
  });
});

describe("rest map", () => {
  it("maps spec paths", () => {
    assert.equal(mapRestPath("GET", "/api/v1/projects", {})?.tool, "list_projects");
    assert.equal(mapRestPath("POST", "/api/v1/interpolate", {})?.tool, "interpolate_frames");
    assert.equal(mapRestPath("GET", "/api/v1/jobs/abc", {})?.tool, "get_job");
    assert.equal(mapRestPath("POST", "/api/v1/repair/range", {})?.tool, "repair_frame_range");
    assert.equal(mapRestPath("POST", "/api/v1/videos/v1/extract", {})?.tool, "extract_video");
    assert.equal(mapRestPath("GET", "/api/v1/frames/frm_1/analysis", {})?.tool, "get_frame_analysis");
    assert.equal(mapRestPath("GET", "/api/v1/frames/frm_1/neighbors", {})?.tool, "get_frame_neighbors");
    assert.equal(mapRestPath("POST", "/api/v1/keyframes/range", {})?.tool, "create_keyframe_range");
    assert.equal(mapRestPath("POST", "/api/v1/repair/region", {})?.tool, "regenerate_region");
    assert.equal(mapRestPath("GET", "/api/v1/models/status", {})?.tool, "get_model_status");
    assert.equal(mapRestPath("GET", "/api/v1/keyframes", { timelineId: "t" })?.tool, "get_keyframes");
    assert.equal(mapRestPath("GET", "/api/v1/characters/c1/track", {})?.tool, "get_character_track");
    assert.equal(mapRestPath("GET", "/api/v1/objects/o1/track", {})?.tool, "get_object_track");
    assert.equal(mapRestPath("POST", "/api/v1/jobs/j1/cancel", {})?.tool, "cancel_job");
  });
});

describe("resources + storage", () => {
  it("parses resource URIs", () => {
    const p = parseResourceUri("framelab://frames/frm_1/neighbors");
    assert.deepEqual(p, { kind: "frames", id: "frm_1", extra: "neighbors" });
  });
  it("rejects traversal ids", () => {
    assert.throws(() => assertSafeId("../etc"), FrameLabError);
    assertSafeId("prj_abc");
  });
  it("declares spec storage dirs", () => {
    for (const d of ["source", "frames", "thumbnails", "masks", "flow", "depth", "generated", "repaired", "renders", "revisions"]) {
      assert.ok((STORAGE_DIRS as readonly string[]).includes(d));
    }
  });
});

describe("character track status", () => {
  it("marks holes as lost and the next hit as recovered", () => {
    const annotated = annotateCharacterTrack([
      { frame_number: 0, visible: true, occluded: false },
      { frame_number: 1, visible: true, occluded: false },
      { frame_number: 3, visible: true, occluded: false },
      { frame_number: 4, visible: true, occluded: true },
    ]);
    assert.equal(annotated.find((r) => r.frameNumber === 2)?.status, "lost");
    assert.equal(annotated.find((r) => r.frameNumber === 3)?.status, "recovered");
    assert.equal(annotated.find((r) => r.frameNumber === 4)?.status, "occluded");
  });
});

describe("mcp invalid scope / unknown tool", () => {
  it("unknown tool is MCP_TOOL_ERROR", () => {
    try {
      assertToolAllowed(["READ"], "not_a_real_tool");
      assert.fail("expected throw");
    } catch (err) {
      assert.ok(err instanceof FrameLabError);
      assert.equal((err as FrameLabError).code, "MCP_TOOL_ERROR");
    }
  });
  it("readonly cannot generate inbetweens", () => {
    try {
      assertToolAllowed(["READ"], "generate_inbetweens");
      assert.fail("expected throw");
    } catch (err) {
      assert.ok(err instanceof FrameLabError);
      assert.equal((err as FrameLabError).code, "PERMISSION_DENIED");
    }
  });
  it("cancel_job is EDIT, list_mcp_clients is ADMIN", () => {
    assert.equal(TOOL_SCOPES.cancel_job, "EDIT");
    assert.equal(TOOL_SCOPES.list_mcp_clients, "ADMIN");
    assert.throws(() => assertToolAllowed(["READ"], "cancel_job"), FrameLabError);
    assertToolAllowed(["ADMIN"], "list_mcp_clients");
  });
});

describe("custom motion curve knots", () => {
  it("interpolates between knots", () => {
    assert.equal(applyCustomCurve(0, [0, 1]), 0);
    assert.equal(applyCustomCurve(1, [0, 1]), 1);
    assert.ok(Math.abs(applyCustomCurve(0.5, [0, 1]) - 0.5) < 1e-9);
  });
});
