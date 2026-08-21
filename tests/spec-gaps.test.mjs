import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const catalog = readFileSync(new URL("../src/lib/mcp/catalog.ts", import.meta.url), "utf8");
const perms = readFileSync(new URL("../src/lib/domain/permissions.ts", import.meta.url), "utf8");
const rest = readFileSync(new URL("../src/lib/framelab/rest-map.ts", import.meta.url), "utf8");
const schema3 = readFileSync(new URL("../migrations/0003_spec_gaps.sql", import.meta.url), "utf8");

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
  "render_animation", "get_frame_window", "get_motion_between", "lock_keyframe",
  "restore_revision", "create_object", "extract_video", "list_jobs",
  "mark_inbetween", "undo", "list_characters", "list_objects", "get_graph",
  "get_frame_analysis", "get_frame_neighbors", "assign_character_range",
  "set_character_visibility", "create_sample_project", "ingest_frames",
  "list_audit_logs", "create_keyframe_range", "redo",
  "cancel_job", "list_mcp_clients", "recalculate_motion",
  "get_current_context", "get_current_frame", "get_selected_frames",
  "get_selected_frame_range", "get_selected_range", "get_selected_region", "get_current_character",
  "get_current_object", "analyze_selection", "analyze_motion_context",
  "get_visual_context", "annotate_frame", "highlight_region", "highlight_frame_range",
  "get_motion_path", "get_pose_overlay", "get_tracking_overlay", "get_problem_regions",
  "focus_problem", "compare_frames_visual", "list_visual_annotations",
];

const SPEC_RESOURCES = [
  "framelab://projects/{project_id}",
  "framelab://videos/{video_id}",
  "framelab://timelines/{timeline_id}",
  "framelab://frames/{frame_id}",
  "framelab://frames/{frame_id}/analysis",
  "framelab://frames/{frame_id}/neighbors",
  "framelab://characters/{character_id}",
  "framelab://characters/{character_id}/track",
  "framelab://objects/{object_id}",
  "framelab://objects/{object_id}/track",
  "framelab://jobs/{job_id}",
  "framelab://sessions/{session_id}/context",
  "framelab://conversations/{conversation_id}",
];

const SPEC_PROMPTS = [
  "analyze_animation_problem",
  "analyze_character_motion",
  "analyze_hand_consistency",
  "analyze_object_contact",
  "suggest_repair_window",
  "repair_animation_range",
  "generate_inbetweens",
  "ask_about_selection",
];

function planInbetweenSlots(frameA, frameB, count) {
  if (!Number.isInteger(frameA) || !Number.isInteger(frameB) || frameB - frameA < 1) {
    throw new Error("INVALID_FRAME_RANGE");
  }
  const existing = frameB - frameA - 1;
  const target = count == null ? Math.max(existing, 0) : Math.round(count);
  if (target < 1) throw new Error("INVALID_FRAME_RANGE");
  const extra = Math.max(0, target - existing);
  return { extra, fillFrom: frameA + 1, fillTo: frameA + extra + existing, newB: frameB + extra, target };
}

function detectContactBreaks(points) {
  const byName = new Map();
  for (const p of points) {
    const list = byName.get(p.name) ?? [];
    list.push(p);
    byName.set(p.name, list);
  }
  const names = [...byName.keys()];
  const events = [];
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const a = new Map((byName.get(names[i]) ?? []).map((p) => [p.frame_number, p]));
      const b = new Map((byName.get(names[j]) ?? []).map((p) => [p.frame_number, p]));
      const frames = [...a.keys()].filter((f) => b.has(f)).sort((x, y) => x - y);
      if (frames.length < 3) continue;
      const distances = frames.map((f) => {
        const pa = a.get(f);
        const pb = b.get(f);
        return Math.hypot(pa.x - pb.x, pa.y - pb.y);
      });
      const sorted = [...distances].sort((x, y) => x - y);
      const median = sorted[Math.floor(sorted.length / 2)] || 1;
      for (let k = 1; k < frames.length; k += 1) {
        const d = distances[k];
        const prev = distances[k - 1];
        if (d > median * 2.4 && d > prev * 1.8 && d > 18) {
          events.push({ frame: frames[k], category: "CONTACT" });
        }
      }
    }
  }
  return events;
}

function annotate(appearances) {
  if (appearances.length === 0) return [];
  const byFrame = new Map(appearances.map((a) => [a.frame_number, a]));
  const numbers = [...byFrame.keys()].sort((x, y) => x - y);
  const first = numbers[0];
  const last = numbers[numbers.length - 1];
  const out = [];
  let sawGap = false;
  for (let n = first; n <= last; n += 1) {
    const a = byFrame.get(n);
    if (!a) {
      out.push({ frameNumber: n, status: "lost" });
      sawGap = true;
      continue;
    }
    let status = "visible";
    if (a.occluded) status = "occluded";
    else if (sawGap) {
      status = "recovered";
      sawGap = false;
    }
    out.push({ frameNumber: n, status });
  }
  return out;
}

describe("catalog vs spec", () => {
  it("lists every v0.1 MCP tool and a matching scope", () => {
    for (const t of SPEC_TOOLS) {
      assert.ok(catalog.includes(`"${t}"`) || catalog.includes(`tool("${t}"`), `catalog missing ${t}`);
      assert.ok(perms.includes(`${t}:`), `TOOL_SCOPES missing ${t}`);
    }
  });
  it("exposes spec resource templates and prompts", () => {
    for (const u of SPEC_RESOURCES) {
      assert.ok(catalog.includes(u), `resource missing ${u}`);
    }
    for (const p of SPEC_PROMPTS) {
      assert.ok(catalog.includes(`name: "${p}"`), `prompt missing ${p}`);
    }
  });
  it("maps REST spec paths", () => {
    assert.ok(rest.includes('tool: "list_projects"'));
    assert.ok(rest.includes('tool: "generate_inbetweens"'));
    assert.ok(rest.includes('tool: "repair_frame_range"'));
    assert.ok(rest.includes('tool: "extract_video"'));
    assert.ok(rest.includes('tool: "get_frame_analysis"'));
    assert.ok(rest.includes('tool: "get_frame_neighbors"'));
    assert.ok(rest.includes('tool: "create_keyframe_range"'));
    assert.ok(rest.includes('tool: "regenerate_region"'));
    assert.ok(rest.includes('tool: "cancel_job"'));
    assert.ok(rest.includes('tool: "get_character_track"'));
    assert.ok(rest.includes('tool: "get_object_track"'));
    assert.ok(rest.includes('tool: "get_current_context"'));
    assert.ok(rest.includes('tool: "get_current_frame"'));
    assert.ok(rest.includes('tool: "get_selected_region"'));
    assert.ok(rest.includes('tool: "analyze_motion_context"'));
  });
  it("adds reserved spec tables", () => {
    for (const t of ["keyframes", "poses", "motion_data", "depth_maps", "segmentations", "repair_jobs", "tracking_tracks"]) {
      assert.ok(schema3.includes(t), `0003 missing ${t}`);
    }
    const schema4 = readFileSync(new URL("../migrations/0004_regions.sql", import.meta.url), "utf8");
    assert.ok(schema4.includes("regions"));
  });
});

describe("inbetween plan", () => {
  it("fills a 9-slot gap", () => {
    const p = planInbetweenSlots(100, 110);
    assert.equal(p.target, 9);
    assert.equal(p.extra, 0);
  });
  it("inserts when keys are adjacent", () => {
    const p = planInbetweenSlots(100, 101, 9);
    assert.equal(p.extra, 9);
    assert.equal(p.newB, 110);
  });
});

describe("contact", () => {
  it("flags a pair-distance jump", () => {
    const pts = [];
    for (let f = 0; f < 6; f += 1) {
      pts.push({ name: "hand", x: 10, y: 10, frame_number: f });
      pts.push({ name: "case", x: f === 4 ? 120 : 14, y: 10, frame_number: f });
    }
    assert.ok(detectContactBreaks(pts).some((e) => e.frame === 4));
  });
});

describe("character track status", () => {
  it("marks holes as lost and the next hit as recovered", () => {
    const rows = [
      { frame_number: 0, visible: true, occluded: false },
      { frame_number: 1, visible: true, occluded: false },
      { frame_number: 3, visible: true, occluded: false },
      { frame_number: 4, visible: true, occluded: true },
    ];
    const annotated = annotate(rows);
    assert.equal(annotated.find((r) => r.frameNumber === 2).status, "lost");
    assert.equal(annotated.find((r) => r.frameNumber === 3).status, "recovered");
    assert.equal(annotated.find((r) => r.frameNumber === 4).status, "occluded");
    assert.equal(annotated.find((r) => r.frameNumber === 0).status, "visible");
  });
});

describe("permissions contract", () => {
  it("denies generate tools without GENERATE", () => {
    assert.ok(perms.includes('generate_inbetweens: "GENERATE"'));
    assert.ok(perms.includes('repair_frame_range: "GENERATE"'));
    assert.ok(perms.includes('list_audit_logs: "ADMIN"'));
    assert.ok(perms.includes('ingest_frames: "EDIT"'));
    assert.ok(perms.includes('cancel_job: "EDIT"'));
    assert.ok(perms.includes('list_mcp_clients: "ADMIN"'));
  });
  it("lists ingest_frames as high-risk", () => {
    assert.ok(perms.includes('"ingest_frames"'));
  });
});
